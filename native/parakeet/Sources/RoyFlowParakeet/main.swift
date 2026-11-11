/* Line-delimited JSON over stdin/stdout.
   in:  {"cmd":"load"} | {"cmd":"download"} | {"cmd":"warm"} | {"cmd":"transcribe","id":1,"path":"/x.wav","urgent":true}
   out: {"type":"missing"} {"type":"progress","done":0.4} {"type":"ready","ms":900}
        {"type":"result","id":1,"text":"…","language":"english","ms":80} {"type":"error","id":1,"message":"…"} */
import FluidAudio
import Foundation
import NaturalLanguage

setvbuf(stdout, nil, _IOLBF, 0)
// a dictation waits on us: keep macOS from napping or throttling this background process between requests
let activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep, .latencyCritical], reason: "Roy Flow speech recognition")
let outLock = NSLock()
func emit(_ obj: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
  outLock.lock(); print(s); outLock.unlock()
}

let args = CommandLine.arguments
guard let mi = args.firstIndex(of: "--models"), mi + 1 < args.count else {
  FileHandle.standardError.write("usage: RoyFlowParakeet --models <dir>\n".data(using: .utf8)!)
  exit(2)
}
let modelsDir = URL(fileURLWithPath: args[mi + 1]).appendingPathComponent("parakeet-ultra", isDirectory: true)
let version = AsrModelVersion.ultra

/// "english", "french"… like whisper-server's verbose_json, so the app treats both engines alike
func languageName(_ text: String) -> String? {
  let r = NLLanguageRecognizer()
  r.processString(text)
  guard let lang = r.dominantLanguage, text.count >= 12 else { return nil }
  return Locale(identifier: "en").localizedString(forLanguageCode: lang.rawValue)?.lowercased()
}

actor Engine {
  var asr: AsrManager?
  var loading: Task<Void, Error>?

  func ensureLoaded(download: Bool) async throws {
    if asr != nil { return }
    if let l = loading { return try await l.value }
    if !download && !AsrModels.modelsExist(at: modelsDir, version: version) {
      emit(["type": "missing"])
      throw NSError(domain: "parakeet", code: 1, userInfo: [NSLocalizedDescriptionKey: "The Parakeet model is not downloaded"])
    }
    let t = Task {
      let t0 = Date()
      var last = -1
      // already downloaded: load straight from disk (downloadAndLoad also checks Hugging Face, which is slow and needs a network)
      let models: AsrModels
      if AsrModels.modelsExist(at: modelsDir, version: version) {
        models = try await AsrModels.load(from: modelsDir, version: version)
      } else {
        models = try await AsrModels.downloadAndLoad(to: modelsDir, version: version) { p in
          let pct = Int(p.fractionCompleted * 100)
          if pct != last { last = pct; emit(["type": "progress", "done": p.fractionCompleted]) }
        }
      }
      FileHandle.standardError.write("[parakeet] models loaded in \(Int(Date().timeIntervalSince(t0) * 1000)) ms\n".data(using: .utf8)!)
      let m = AsrManager(config: .default)
      try await m.loadModels(models)
      // warm the Neural Engine so the first real request is fast
      var st = TdtDecoderState.make(decoderLayers: await m.decoderLayerCount)
      _ = try? await m.transcribe([Float](repeating: 0, count: 16_000), decoderState: &st)
      self.asr = m
      emit(["type": "ready", "ms": Int(Date().timeIntervalSince(t0) * 1000)])
    }
    loading = t
    do { try await t.value } catch { loading = nil; throw error }
  }

  /// a tiny inference so the Neural Engine is awake: macOS lets the model go cold after a few idle minutes,
  /// which made the first dictation after a break take 1.4 s instead of 0.15 s. Sent on key-down.
  func warm() async {
    guard let m = asr else { return }
    let t0 = Date()
    var st = TdtDecoderState.make(decoderLayers: await m.decoderLayerCount)
    _ = try? await m.transcribe([Float](repeating: 0, count: 8_000), decoderState: &st)
    emit(["type": "warm", "ms": Int(Date().timeIntervalSince(t0) * 1000)])
  }

  func transcribe(_ path: String) async throws -> (String, Double) {
    try await ensureLoaded(download: false)
    guard let m = asr else { throw NSError(domain: "parakeet", code: 2) }
    var st = TdtDecoderState.make(decoderLayers: await m.decoderLayerCount)
    let t0 = Date()
    let r = try await m.transcribe(URL(fileURLWithPath: path), decoderState: &st)
    return (r.text.trimmingCharacters(in: .whitespacesAndNewlines), Date().timeIntervalSince(t0))
  }
}
let engine = Engine()

if args.contains("--selftest") {
  let sem = DispatchSemaphore(value: 0)
  Task {
    do {
      try await engine.ensureLoaded(download: false)
      if let i = args.firstIndex(of: "--file"), i + 1 < args.count {
        let (text, s) = try await engine.transcribe(args[i + 1])
        emit(["type": "result", "text": text, "language": languageName(text) ?? "", "ms": Int(s * 1000)])
      }
    } catch { emit(["type": "error", "message": error.localizedDescription]) }
    sem.signal()
  }
  sem.wait()
  exit(0)
}

Task.detached {
  while let line = readLine() {
    guard let d = line.data(using: .utf8), let msg = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let cmd = msg["cmd"] as? String else { continue }
    switch cmd {
    case "load", "download":
      Task {
        do { try await engine.ensureLoaded(download: cmd == "download") } catch { emit(["type": "loadError", "message": error.localizedDescription]) }
      }
    case "transcribe":
      let id = msg["id"] ?? 0
      guard let path = msg["path"] as? String else { continue }
      Task(priority: .userInitiated) {
        do {
          let (text, s) = try await engine.transcribe(path)
          emit(["type": "result", "id": id, "text": text, "language": languageName(text) ?? "", "ms": Int(s * 1000)])
        } catch {
          emit(["type": "error", "id": id, "message": error.localizedDescription])
        }
      }
    case "warm":
      Task { await engine.warm() }
    case "quit":
      exit(0)
    default: break
    }
  }
  exit(0) // the app closed our stdin
}
dispatchMain()
