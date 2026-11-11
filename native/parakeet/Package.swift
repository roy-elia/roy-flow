// swift-tools-version: 6.0
// Roy Flow's local speech engine: NVIDIA Parakeet (Ultra, 25 European languages) on the Neural Engine via FluidAudio.
import PackageDescription

let package = Package(
  name: "RoyFlowParakeet",
  platforms: [.macOS(.v14)],
  dependencies: [
    .package(url: "https://github.com/FluidInference/FluidAudio.git", revision: "a31f151")
  ],
  targets: [
    .executableTarget(
      name: "RoyFlowParakeet",
      dependencies: [.product(name: "FluidAudio", package: "FluidAudio")],
      swiftSettings: [.swiftLanguageMode(.v5)]
    )
  ]
)
