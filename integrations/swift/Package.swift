// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "HarnessSwift",
    products: [
        .library(name: "HarnessRules", targets: ["HarnessRules"]),
        .executable(name: "harness-swift-lint", targets: ["harness-swift-lint"]),
        .plugin(name: "HarnessBuildPlugin", targets: ["HarnessBuildPlugin"])
    ],
    targets: [
        .target(name: "HarnessRules"),
        // Keep the tool target and product names identical: Xcode resolves plugin tools by target name.
        .executableTarget(name: "harness-swift-lint", dependencies: ["HarnessRules"], path: "Sources/HarnessSwiftLint"),
        .plugin(name: "HarnessBuildPlugin", capability: .buildTool(), dependencies: ["harness-swift-lint"]),
        .testTarget(name: "HarnessRulesTests", dependencies: ["HarnessRules"])
    ]
)
