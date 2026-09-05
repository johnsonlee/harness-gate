// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "HarnessIOSExample",
    platforms: [.iOS(.v15)],
    products: [.library(name: "App", targets: ["App"])],
    dependencies: [.package(name: "HarnessSwift", path: "../../integrations/swift")],
    targets: [
        .target(
            name: "App",
            plugins: [.plugin(name: "HarnessBuildPlugin", package: "HarnessSwift")]
        )
    ]
)
