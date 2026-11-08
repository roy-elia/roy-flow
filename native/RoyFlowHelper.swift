// RoyFlowHelper: the small native helper the Roy Flow main process spawns.
// Speaks line-delimited JSON on stdin/stdout.
//
// in : {"cmd":"start","locale":"en-US","device":"<input name>","mode":"dictation"|"meeting","record":"/path.wav"}
//      {"cmd":"stop"} | {"cmd":"cancel"}
//      {"cmd":"paste"} | {"cmd":"copy"}                       synthetic ⌘V / ⌘C into the frontmost app
//      {"cmd":"access","prompt":false,"listen":false}          Accessibility / Input Monitoring status
//      {"cmd":"devices"} | {"cmd":"frontmost"}
//      {"cmd":"hotkeys","bindings":[{"action":"ptt","keys":["fn"],"hold":true,"when":null}]}
//      {"cmd":"context","flags":["recording","changes"]}      contextual bindings (Esc while recording...)
//      {"cmd":"record","on":true}                              shortcut capture mode (reports "keys")
//      {"cmd":"mute","on":true}                                mute / restore system output
//      {"cmd":"sound","path":"/x.wav","volume":0.5}
//      {"cmd":"calendar","request":false,"days":7}
//      {"cmd":"quit"}
// out: {"type":"ready"} {"type":"started","onDevice":true} {"type":"partial","text":"..."}
//      {"type":"final","text":"...","audio":"/path.wav"|null,"seconds":3.2}
//      {"type":"segment","text":"...","start":12.5}            meeting mode: a finished stretch of speech
//      {"type":"level","value":0.42} {"type":"cancelled"}
//      {"type":"pasted","ok":true} {"type":"copied","ok":true}
//      {"type":"access","trusted":true,"listen":true,"tap":"active"|"listen"|"off"}
//      {"type":"devices","devices":[...]} {"type":"frontmost","bundleId":"...","name":"..."}
//      {"type":"hotkey","action":"ptt","phase":"down"|"up"|"press"|"abort"}
//      {"type":"keys","down":["opt","space"]} {"type":"tap","state":"active"|"listen"|"off"}
//      {"type":"calendar","status":"authorized"|"denied"|"notDetermined"|"restricted","events":[...]}
//      {"type":"authorizing","service":"microphone"|"speech"} {"type":"error","code":"...","message":"..."}
import AVFoundation
import AppKit
import ApplicationServices
import CoreAudio
import EventKit
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)
let outQueue = DispatchQueue(label: "royflow.helper.out")

func emit(_ obj: [String: Any]) {
    outQueue.async {
        guard let data = try? JSONSerialization.data(withJSONObject: obj), let line = String(data: data, encoding: .utf8) else { return }
        FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    }
}

func emitError(_ code: String, _ message: String) { emit(["type": "error", "code": code, "message": message]) }

/// marks events this helper posts so its own event tap ignores them
let syntheticMarker: Int64 = 0x524F_5946 // "ROYF"

// MARK: - CoreAudio devices

func inputDevices() -> [(id: AudioDeviceID, name: String)] {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
    var out: [(AudioDeviceID, String)] = []
    for id in ids {
        var cfg = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
        var cfgSize: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &cfg, 0, nil, &cfgSize) == noErr, cfgSize > 0 else { continue }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(cfgSize), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &cfg, 0, nil, &cfgSize, raw) == noErr else { continue }
        let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
        let channels = list.reduce(0) { $0 + Int($1.mNumberChannels) }
        guard channels > 0 else { continue }
        var nameAddr = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var name: Unmanaged<CFString>?
        var nameSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(id, &nameAddr, 0, nil, &nameSize, &name) == noErr, let n = name?.takeRetainedValue() else { continue }
        out.append((id, n as String))
    }
    return out
}

// MARK: - System output mute (saved and restored around dictation)

final class OutputMute {
    private var saved: (device: AudioDeviceID, mute: UInt32?, volume: Float32?)?

    private func defaultOutput() -> AudioDeviceID? {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var dev = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev) == noErr, dev != 0 else { return nil }
        return dev
    }

    private func settable(_ dev: AudioDeviceID, _ addr: inout AudioObjectPropertyAddress) -> Bool {
        guard AudioObjectHasProperty(dev, &addr) else { return false }
        var ok: DarwinBoolean = false
        return AudioObjectIsPropertySettable(dev, &addr, &ok) == noErr && ok.boolValue
    }

    func mute() {
        guard saved == nil, let dev = defaultOutput() else { return }
        var muteAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
        if settable(dev, &muteAddr) {
            var cur: UInt32 = 0
            var size = UInt32(MemoryLayout<UInt32>.size)
            AudioObjectGetPropertyData(dev, &muteAddr, 0, nil, &size, &cur)
            saved = (dev, cur, nil)
            var one: UInt32 = 1
            AudioObjectSetPropertyData(dev, &muteAddr, 0, nil, size, &one)
            return
        }
        var volAddr = AudioObjectPropertyAddress(mSelector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
        if settable(dev, &volAddr) {
            var cur: Float32 = 0
            var size = UInt32(MemoryLayout<Float32>.size)
            AudioObjectGetPropertyData(dev, &volAddr, 0, nil, &size, &cur)
            saved = (dev, nil, cur)
            var zero: Float32 = 0
            AudioObjectSetPropertyData(dev, &volAddr, 0, nil, size, &zero)
        }
    }

    func restore() {
        guard let s = saved else { return }
        saved = nil
        if let m = s.mute {
            var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
            var v = m
            AudioObjectSetPropertyData(s.device, &addr, 0, nil, UInt32(MemoryLayout<UInt32>.size), &v)
        }
        if let vol = s.volume {
            var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
            var v = vol
            AudioObjectSetPropertyData(s.device, &addr, 0, nil, UInt32(MemoryLayout<Float32>.size), &v)
        }
    }
}

// MARK: - Speech session (dictation, or a long meeting transcribed in segments)

final class Dictation {
    private var engine: AVAudioEngine?
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var file: AVAudioFile?
    private var filePath: String?
    private var session = 0
    private var lastText = ""
    private var stopping = false
    private var finished = true
    private var lastLevel: TimeInterval = 0
    private var startedAt = Date()
    private var mode = "dictation"
    // meeting mode
    private var segmentStart: TimeInterval = 0
    private var segmentText = ""
    private var rotateTimer: Timer?
    private var pendingSegments = 0

    var busy: Bool { !finished }

    func start(locale: String, device: String?, mode: String, record: String?) {
        guard finished else { return emitError("busy", mode == "meeting" ? "Something is already recording" : "A recording is already running") }
        finished = false
        stopping = false
        lastText = ""
        self.mode = mode
        session += 1
        let id = session
        authorize { [weak self] ok in
            guard let self, id == self.session, !self.finished else { return }
            guard ok else { self.finished = true; return }
            self.begin(locale: locale, device: device, record: record, session: id)
        }
    }

    private func authorize(_ done: @escaping (Bool) -> Void) {
        let speech = { (next: @escaping () -> Void) in
            switch SFSpeechRecognizer.authorizationStatus() {
            case .authorized: next()
            case .notDetermined:
                emit(["type": "authorizing", "service": "speech"])
                SFSpeechRecognizer.requestAuthorization { st in
                    DispatchQueue.main.async {
                        if st == .authorized { next() } else { emitError("speech-denied", "Speech recognition permission was not granted"); done(false) }
                    }
                }
            default:
                emitError("speech-denied", "Speech recognition is not allowed. Enable Roy Flow in System Settings > Privacy & Security > Speech Recognition.")
                done(false)
            }
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: speech { done(true) }
        case .notDetermined:
            emit(["type": "authorizing", "service": "microphone"])
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                DispatchQueue.main.async {
                    if ok { speech { done(true) } } else { emitError("mic-denied", "Microphone permission was not granted"); done(false) }
                }
            }
        default:
            emitError("mic-denied", "Microphone access is not allowed. Enable Roy Flow in System Settings > Privacy & Security > Microphone.")
            done(false)
        }
    }

    private func makeRequest(onDevice: Bool) -> SFSpeechAudioBufferRecognitionRequest {
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if onDevice { req.requiresOnDeviceRecognition = true }
        if #available(macOS 13, *) { req.addsPunctuation = true }
        return req
    }

    private func begin(locale: String, device: String?, record: String?, session id: Int) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
            finished = true
            return emitError("unavailable", "Speech recognition is not available for \(locale)")
        }
        self.recognizer = recognizer
        let onDevice = recognizer.supportsOnDeviceRecognition
        let req = makeRequest(onDevice: onDevice)

        let engine = AVAudioEngine()
        let input = engine.inputNode
        var usedDevice = "default"
        if let device, !device.isEmpty {
            if let match = inputDevices().first(where: { $0.name == device }), let au = input.audioUnit {
                var devId = match.id
                let st = AudioUnitSetProperty(au, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &devId, UInt32(MemoryLayout<AudioDeviceID>.size))
                if st == noErr { usedDevice = match.name }
            }
        }
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            finished = true
            return emitError("no-input", "No microphone input is available")
        }
        file = nil
        filePath = nil
        if let record, !record.isEmpty {
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: format.sampleRate,
                AVNumberOfChannelsKey: format.channelCount,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
            ]
            if let f = try? AVAudioFile(forWriting: URL(fileURLWithPath: record), settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false) {
                file = f
                filePath = record
            }
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            self.request?.append(buffer)
            if let f = self.file { try? f.write(from: buffer) }
            self.level(buffer)
        }
        engine.prepare()
        do { try engine.start() } catch {
            input.removeTap(onBus: 0)
            finished = true
            file = nil
            return emitError("audio", "Could not start the microphone: \(error.localizedDescription)")
        }
        self.engine = engine
        self.request = req
        startedAt = Date()
        if mode == "meeting" {
            segmentStart = 0
            segmentText = ""
            startSegmentTask(recognizer: recognizer, request: req, session: id)
            rotateTimer = Timer.scheduledTimer(withTimeInterval: 45, repeats: true) { [weak self] _ in self?.rotate(onDevice: onDevice) }
        } else {
            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self, id == self.session, !self.finished else { return }
                    if let result {
                        self.lastText = result.bestTranscription.formattedString
                        if result.isFinal { return self.finish() }
                        emit(["type": "partial", "text": self.lastText])
                    }
                    if let error {
                        if self.stopping { return self.finish() }
                        let ns = error as NSError
                        // 1110 = no speech detected, 216/301 = cancelled
                        if ns.code == 1110 || ns.code == 216 || ns.code == 301 { return }
                        emitError("recognition", error.localizedDescription)
                    }
                }
            }
        }
        emit(["type": "started", "onDevice": onDevice, "device": usedDevice, "mode": mode])
    }

    // meeting mode: each recognition task covers ~45 s; finished tasks are reported as segments
    private func startSegmentTask(recognizer: SFSpeechRecognizer, request req: SFSpeechAudioBufferRecognitionRequest, session id: Int) {
        let start = Date().timeIntervalSince(startedAt)
        var latest = ""
        var reported = false
        pendingSegments += 1
        let report = { [weak self] in
            guard let self, !reported else { return }
            reported = true
            self.pendingSegments -= 1
            let t = latest.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { emit(["type": "segment", "text": t, "start": (start * 10).rounded() / 10]) }
            if self.stopping && self.pendingSegments <= 0 { self.finish() }
        }
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, id == self.session else { return }
                if let result {
                    latest = result.bestTranscription.formattedString
                    if result.isFinal { return report() }
                    if self.request === req { emit(["type": "partial", "text": latest]) }
                }
                if error != nil { report() }
            }
        }
    }

    private func rotate(onDevice: Bool) {
        guard mode == "meeting", !finished, !stopping, let recognizer, let old = request else { return }
        let next = makeRequest(onDevice: onDevice)
        request = next // new buffers go to the new request from here on
        old.endAudio()
        startSegmentTask(recognizer: recognizer, request: next, session: session)
    }

    private func level(_ buffer: AVAudioPCMBuffer) {
        let now = Date().timeIntervalSince1970
        guard now - lastLevel > 0.05, let data = buffer.floatChannelData?[0] else { return }
        lastLevel = now
        let n = Int(buffer.frameLength)
        guard n > 0 else { return }
        var sum: Float = 0
        for i in 0..<n { sum += data[i] * data[i] }
        let rms = sqrt(sum / Float(n))
        let db = 20 * log10(max(rms, 0.000_01))
        let v = min(1, max(0, (db + 55) / 45))
        emit(["type": "level", "value": (Double(v) * 100).rounded() / 100])
    }

    private func stopAudio() {
        rotateTimer?.invalidate()
        rotateTimer = nil
        if let engine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        engine = nil
        file = nil // closes and finalises the WAV header
    }

    func stop() {
        guard !finished, !stopping else { return }
        stopping = true
        stopAudio()
        request?.endAudio()
        if task == nil { return finish() }
        let id = session
        DispatchQueue.main.asyncAfter(deadline: .now() + (mode == "meeting" ? 6 : 3)) { [weak self] in
            guard let self, id == self.session else { return }
            self.finish()
        }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        stopAudio()
        if mode != "meeting" { task?.cancel() }
        task = nil
        request = nil
        pendingSegments = 0
        emit(["type": "final", "text": lastText, "audio": filePath ?? NSNull(), "seconds": (Date().timeIntervalSince(startedAt) * 10).rounded() / 10, "mode": mode])
    }

    func cancel() {
        guard !finished else { return emit(["type": "cancelled"]) }
        finished = true
        session += 1
        stopAudio()
        task?.cancel()
        task = nil
        request = nil
        pendingSegments = 0
        if let p = filePath { try? FileManager.default.removeItem(atPath: p) }
        filePath = nil
        emit(["type": "cancelled"])
    }
}

// MARK: - Keystrokes (paste / copy into the frontmost app)

func accessibilityTrusted(prompt: Bool) -> Bool {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
}

func postCommandKey(_ key: CGKeyCode) {
    let src = CGEventSource(stateID: .privateState)
    let down = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: true)
    let up = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: false)
    for e in [down, up] {
        e?.flags = .maskCommand
        e?.setIntegerValueField(.eventSourceUserData, value: syntheticMarker)
    }
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
}

func keystroke(_ type: String, _ key: CGKeyCode) {
    guard accessibilityTrusted(prompt: false) else {
        return emit(["type": type, "ok": false, "reason": "accessibility"])
    }
    postCommandKey(key)
    emit(["type": type, "ok": true])
}

// MARK: - Global hotkeys (CGEventTap: modifier-only chords, fn / Globe, hold vs tap)

let keyNames: [Int: String] = [
    0: "a", 1: "s", 2: "d", 3: "f", 4: "h", 5: "g", 6: "z", 7: "x", 8: "c", 9: "v", 11: "b", 12: "q", 13: "w", 14: "e", 15: "r",
    16: "y", 17: "t", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0",
    30: "]", 31: "o", 32: "u", 33: "[", 34: "i", 35: "p", 36: "return", 37: "l", 38: "j", 39: "'", 40: "k", 41: ";", 42: "\\",
    43: ",", 44: "/", 45: "n", 46: "m", 47: ".", 48: "tab", 49: "space", 50: "`", 51: "backspace", 53: "esc",
    64: "f17", 79: "f18", 80: "f19", 90: "f20", 96: "f5", 97: "f6", 98: "f7", 99: "f3", 100: "f8", 101: "f9", 103: "f11",
    105: "f13", 106: "f16", 107: "f14", 109: "f10", 111: "f12", 113: "f15", 114: "help", 115: "home", 116: "pageup", 117: "delete",
    118: "f4", 119: "end", 120: "f2", 121: "pagedown", 122: "f1", 123: "left", 124: "right", 125: "down", 126: "up",
]
let modifierOrder = ["fn", "ctrl", "opt", "shift", "cmd"]

struct Binding {
    let action: String
    let mods: Set<String>
    let key: String? // nil = modifier-only chord
    let hold: Bool
    let when: String?
}

final class Hotkeys {
    var bindings: [Binding] = []
    var context: Set<String> = []
    var recording = false
    private(set) var state = "off" // active (can swallow) | listen (observe only) | off
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var mods: Set<String> = []
    private var fnDown = false
    private var pressed: [String] = []
    private var swallowed: Set<String> = []
    private var activeHold: (action: String, binding: Binding)?

    func ensureTap() {
        let wantActive = accessibilityTrusted(prompt: false)
        if let t = tap, CFMachPortIsValid(t) {
            if state == "active" || !wantActive { return }
        }
        teardown()
        let mask: CGEventMask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue) | (1 << CGEventType.flagsChanged.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, _ in
            return hotkeys.handle(type: type, event: event)
        }
        if wantActive, let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap, eventsOfInterest: mask, callback: callback, userInfo: nil) {
            install(t, "active")
        } else if CGPreflightListenEventAccess(), let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: callback, userInfo: nil) {
            install(t, "listen")
        } else if state != "off" {
            state = "off"
            emit(["type": "tap", "state": state])
        }
    }

    private func install(_ t: CFMachPort, _ s: String) {
        tap = t
        source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, t, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: t, enable: true)
        state = s
        emit(["type": "tap", "state": s])
    }

    private func teardown() {
        if let t = tap { CGEvent.tapEnable(tap: t, enable: false) }
        if let s = source { CFRunLoopRemoveSource(CFRunLoopGetMain(), s, .commonModes) }
        tap = nil
        source = nil
    }

    func setBindings(_ list: [[String: Any]]) {
        bindings = list.compactMap { b in
            guard let action = b["action"] as? String, let keys = b["keys"] as? [String], !keys.isEmpty else { return nil }
            let m = Set(keys.filter { modifierOrder.contains($0) })
            let rest = keys.filter { !modifierOrder.contains($0) }
            return Binding(action: action, mods: m, key: rest.first, hold: b["hold"] as? Bool ?? false, when: b["when"] as? String)
        }
        ensureTap()
    }

    private func applies(_ b: Binding) -> Bool { b.when == nil || context.contains(b.when!) }

    private func emitKeys() {
        let ordered = modifierOrder.filter { mods.contains($0) } + pressed
        emit(["type": "keys", "down": ordered])
    }

    func handle(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let t = tap { CGEvent.tapEnable(tap: t, enable: true) }
            return Unmanaged.passUnretained(event)
        }
        if event.getIntegerValueField(.eventSourceUserData) == syntheticMarker { return Unmanaged.passUnretained(event) }
        let pass = Unmanaged.passUnretained(event)
        let canSwallow = state == "active"
        let code = Int(event.getIntegerValueField(.keyboardEventKeycode))

        switch type {
        case .flagsChanged:
            let f = event.flags
            if code == 63 || code == 179 { fnDown = f.contains(.maskSecondaryFn) }
            var m: Set<String> = []
            if fnDown { m.insert("fn") }
            if f.contains(.maskControl) { m.insert("ctrl") }
            if f.contains(.maskAlternate) { m.insert("opt") }
            if f.contains(.maskShift) { m.insert("shift") }
            if f.contains(.maskCommand) { m.insert("cmd") }
            mods = m
            if recording { emitKeys(); return pass }
            if let a = activeHold, a.binding.key == nil, mods != a.binding.mods {
                activeHold = nil
                emit(["type": "hotkey", "action": a.action, "phase": "up"])
            }
            if activeHold == nil, pressed.isEmpty, let b = bindings.first(where: { $0.key == nil && $0.hold && $0.mods == mods && applies($0) }) {
                activeHold = (b.action, b)
                emit(["type": "hotkey", "action": b.action, "phase": "down"])
            }
            return pass

        case .keyDown:
            let name = keyNames[code] ?? "key\(code)"
            let repeatKey = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
            if recording {
                if !pressed.contains(name) { pressed.append(name) }
                emitKeys()
                return canSwallow ? nil : pass
            }
            if repeatKey { return swallowed.contains(name) && canSwallow ? nil : pass }
            if !pressed.contains(name) { pressed.append(name) }
            // a modifier-only hold (e.g. fn) followed by another key is a different chord: abort it
            if let a = activeHold, a.binding.key == nil {
                activeHold = nil
                emit(["type": "hotkey", "action": a.action, "phase": "abort"])
            }
            if let b = bindings.first(where: { $0.key == name && $0.mods == mods && applies($0) }) {
                if b.hold {
                    activeHold = (b.action, b)
                    emit(["type": "hotkey", "action": b.action, "phase": "down"])
                } else {
                    emit(["type": "hotkey", "action": b.action, "phase": "press"])
                }
                swallowed.insert(name)
                return canSwallow ? nil : pass
            }
            return pass

        case .keyUp:
            let name = keyNames[code] ?? "key\(code)"
            pressed.removeAll { $0 == name }
            if recording {
                emitKeys()
                return canSwallow ? nil : pass
            }
            if let a = activeHold, a.binding.key == name {
                activeHold = nil
                emit(["type": "hotkey", "action": a.action, "phase": "up"])
            }
            if swallowed.remove(name) != nil { return canSwallow ? nil : pass }
            return pass

        default:
            return pass
        }
    }

    func setRecording(_ on: Bool) {
        recording = on
        pressed = []
        if on { activeHold = nil }
    }
}

let hotkeys = Hotkeys()

// MARK: - Calendar (EventKit)

let eventStore = EKEventStore()

func calendarStatus() -> String {
    let st = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14, *) {
        switch st {
        case .fullAccess: return "authorized"
        case .writeOnly: return "denied"
        default: break
        }
    }
    switch st {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    default: return "authorized"
    }
}

func sendCalendar(days: Int) {
    let status = calendarStatus()
    guard status == "authorized" else { return emit(["type": "calendar", "status": status, "events": []]) }
    let now = Date()
    let start = Calendar.current.startOfDay(for: now)
    let end = now.addingTimeInterval(Double(days) * 86400)
    let pred = eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
    let events = eventStore.events(matching: pred).sorted { $0.startDate < $1.startDate }.prefix(200).map { e -> [String: Any] in
        [
            "id": e.eventIdentifier ?? UUID().uuidString,
            "title": e.title ?? "Untitled event",
            "start": Int(e.startDate.timeIntervalSince1970 * 1000),
            "end": Int(e.endDate.timeIntervalSince1970 * 1000),
            "allDay": e.isAllDay,
            "calendar": e.calendar?.title ?? "",
            "location": e.location ?? "",
            "attendees": e.attendees?.count ?? 0,
        ]
    }
    emit(["type": "calendar", "status": status, "events": Array(events)])
}

func calendar(request: Bool, days: Int) {
    if calendarStatus() == "notDetermined" && request {
        let done: (Bool, Error?) -> Void = { _, _ in DispatchQueue.main.async { sendCalendar(days: days) } }
        if #available(macOS 14, *) { eventStore.requestFullAccessToEvents(completion: done) } else { eventStore.requestAccess(to: .event, completion: done) }
        return
    }
    sendCalendar(days: days)
}

// MARK: - Frontmost app

func frontmost() -> [String: Any] {
    if let app = NSWorkspace.shared.frontmostApplication {
        return ["type": "frontmost", "bundleId": app.bundleIdentifier ?? "", "name": app.localizedName ?? ""]
    }
    // fallback: owner of the frontmost normal window
    if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
        for w in list where (w[kCGWindowLayer as String] as? Int) == 0 {
            if let pid = w[kCGWindowOwnerPID as String] as? pid_t, let app = NSRunningApplication(processIdentifier: pid) {
                return ["type": "frontmost", "bundleId": app.bundleIdentifier ?? "", "name": app.localizedName ?? ""]
            }
        }
    }
    return ["type": "frontmost", "bundleId": "", "name": ""]
}

// MARK: - Sounds

var currentSound: NSSound?
func play(_ path: String, volume: Float) {
    guard let s = NSSound(contentsOfFile: path, byReference: true) else { return }
    s.volume = volume
    currentSound = s
    s.play()
}

// MARK: - stdin loop

let dictation = Dictation()
let outputMute = OutputMute()

func handle(_ line: String) {
    guard let data = line.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let cmd = obj["cmd"] as? String else {
        return emitError("bad-command", "Could not parse: \(line.prefix(80))")
    }
    switch cmd {
    case "start":
        dictation.start(locale: obj["locale"] as? String ?? "en-US", device: obj["device"] as? String, mode: obj["mode"] as? String ?? "dictation", record: obj["record"] as? String)
    case "stop": dictation.stop()
    case "cancel": dictation.cancel()
    case "paste": keystroke("pasted", 9)
    case "copy": keystroke("copied", 8)
    case "access":
        let trusted = accessibilityTrusted(prompt: obj["prompt"] as? Bool ?? false)
        if obj["listen"] as? Bool ?? false, !CGPreflightListenEventAccess() { _ = CGRequestListenEventAccess() }
        hotkeys.ensureTap()
        emit(["type": "access", "trusted": trusted, "listen": CGPreflightListenEventAccess(), "tap": hotkeys.state])
    case "devices": emit(["type": "devices", "devices": inputDevices().map { $0.name }])
    case "frontmost": emit(frontmost())
    case "hotkeys": hotkeys.setBindings(obj["bindings"] as? [[String: Any]] ?? [])
    case "context": hotkeys.context = Set(obj["flags"] as? [String] ?? [])
    case "record": hotkeys.setRecording(obj["on"] as? Bool ?? false)
    case "mute": if obj["on"] as? Bool ?? false { outputMute.mute() } else { outputMute.restore() }
    case "sound": if let p = obj["path"] as? String { play(p, volume: Float(obj["volume"] as? Double ?? 0.5)) }
    case "calendar": calendar(request: obj["request"] as? Bool ?? false, days: obj["days"] as? Int ?? 7)
    case "quit":
        outputMute.restore()
        exit(0)
    default: emitError("bad-command", "Unknown command \(cmd)")
    }
}

Thread {
    while let line = readLine() {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { continue }
        DispatchQueue.main.async { handle(trimmed) }
    }
    // stdin closed: the parent went away
    DispatchQueue.main.async {
        dictation.cancel()
        outputMute.restore()
        outQueue.sync {}
        exit(0)
    }
}.start()

// keep trying to install the event tap until permissions allow it
Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { _ in
    if !hotkeys.bindings.isEmpty { hotkeys.ensureTap() }
}

emit(["type": "ready", "version": 2])
CFRunLoopRun()
