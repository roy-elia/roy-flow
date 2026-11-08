// RoyFlowHelper: the small native helper the Roy Flow main process spawns.
// Speaks line-delimited JSON on stdin/stdout.
//   in : {"cmd":"start","locale":"en-US","device":"<input name>"} | {"cmd":"stop"} | {"cmd":"cancel"}
//        {"cmd":"paste"} | {"cmd":"access","prompt":false} | {"cmd":"devices"} | {"cmd":"quit"}
//   out: {"type":"ready"} {"type":"started","onDevice":true} {"type":"partial","text":"..."}
//        {"type":"final","text":"..."} {"type":"level","value":0.42} {"type":"cancelled"}
//        {"type":"pasted","ok":true} {"type":"access","trusted":true} {"type":"devices","devices":[...]}
//        {"type":"authorizing","service":"microphone"|"speech"} {"type":"error","code":"...","message":"..."}
import AVFoundation
import ApplicationServices
import CoreAudio
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

// MARK: - CoreAudio input devices

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

// MARK: - Dictation session

final class Dictation {
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var session = 0
    private var lastText = ""
    private var stopping = false
    private var finished = true
    private var lastLevel: TimeInterval = 0

    var busy: Bool { !finished }

    func start(locale: String, device: String?) {
        guard finished else { return emitError("busy", "A dictation is already running") }
        finished = false
        stopping = false
        lastText = ""
        session += 1
        let id = session
        authorize { [weak self] ok in
            guard let self, id == self.session, !self.finished else { return }
            guard ok else { self.finished = true; return }
            self.begin(locale: locale, device: device, session: id)
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

    private func begin(locale: String, device: String?, session id: Int) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
            finished = true
            return emitError("unavailable", "Speech recognition is not available for \(locale)")
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        let onDevice = recognizer.supportsOnDeviceRecognition
        if onDevice { req.requiresOnDeviceRecognition = true }
        if #available(macOS 13, *) { req.addsPunctuation = true }

        let engine = AVAudioEngine()
        let input = engine.inputNode
        if let device, !device.isEmpty, let match = inputDevices().first(where: { $0.name == device }), let au = input.audioUnit {
            var devId = match.id
            AudioUnitSetProperty(au, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &devId, UInt32(MemoryLayout<AudioDeviceID>.size))
        }
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            finished = true
            return emitError("no-input", "No microphone input is available")
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            req.append(buffer)
            self?.level(buffer)
        }
        engine.prepare()
        do { try engine.start() } catch {
            input.removeTap(onBus: 0)
            finished = true
            return emitError("audio", "Could not start the microphone: \(error.localizedDescription)")
        }
        self.engine = engine
        self.request = req
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
        emit(["type": "started", "onDevice": onDevice])
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
        if let engine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        engine = nil
    }

    func stop() {
        guard !finished, !stopping else { return }
        stopping = true
        stopAudio()
        request?.endAudio()
        if task == nil { return finish() }
        let id = session
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, id == self.session else { return }
            self.finish()
        }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        stopAudio()
        task?.cancel()
        task = nil
        request = nil
        emit(["type": "final", "text": lastText])
    }

    func cancel() {
        guard !finished else { return emit(["type": "cancelled"]) }
        finished = true
        session += 1
        stopAudio()
        task?.cancel()
        task = nil
        request = nil
        emit(["type": "cancelled"])
    }
}

// MARK: - Paste

func accessibilityTrusted(prompt: Bool) -> Bool {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
}

func pasteKeystroke() {
    guard accessibilityTrusted(prompt: false) else {
        return emit(["type": "pasted", "ok": false, "reason": "accessibility"])
    }
    let src = CGEventSource(stateID: .combinedSessionState)
    let vKey: CGKeyCode = 9 // kVK_ANSI_V
    let down = CGEvent(keyboardEventSource: src, virtualKey: vKey, keyDown: true)
    let up = CGEvent(keyboardEventSource: src, virtualKey: vKey, keyDown: false)
    down?.flags = .maskCommand
    up?.flags = .maskCommand
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
    emit(["type": "pasted", "ok": true])
}

// MARK: - stdin loop

let dictation = Dictation()

func handle(_ line: String) {
    guard let data = line.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let cmd = obj["cmd"] as? String else {
        return emitError("bad-command", "Could not parse: \(line.prefix(80))")
    }
    switch cmd {
    case "start": dictation.start(locale: obj["locale"] as? String ?? "en-US", device: obj["device"] as? String)
    case "stop": dictation.stop()
    case "cancel": dictation.cancel()
    case "paste": pasteKeystroke()
    case "access": emit(["type": "access", "trusted": accessibilityTrusted(prompt: obj["prompt"] as? Bool ?? false)])
    case "devices": emit(["type": "devices", "devices": inputDevices().map { $0.name }])
    case "quit": exit(0)
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
        outQueue.sync {}
        exit(0)
    }
}.start()

emit(["type": "ready", "version": 1])
dispatchMain()
