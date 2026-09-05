// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "HarnessSwift",
    products: [
        .library(name: "HarnessRules", targets: ["HarnessRules"]),
        .executable(name: "harness-swift-lint", targets: ["HarnessSwiftLint"]),
        .plugin(name: "HarnessBuildPlugin", targets: ["HarnessBuildPlugin"])
    ],
    targets: [
        .target(name: "HarnessRules"),
        .executableTarget(name: "HarnessSwiftLint", dependencies: ["HarnessRules"]),
        .plugin(name: "HarnessBuildPlugin", capability: .buildTool(), dependencies: ["HarnessSwiftLint"]),
        .testTarget(name: "HarnessRulesTests", dependencies: ["HarnessRules"])
    ]
)
