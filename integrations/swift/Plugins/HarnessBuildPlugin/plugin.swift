import PackagePlugin

@main
struct HarnessBuildPlugin: BuildToolPlugin {
    func createBuildCommands(context: PluginContext, target: Target) throws -> [Command] {
        guard let target = target as? SourceModuleTarget else { return [] }
        return [try command(
            root: context.package.directory,
            target: target.name,
            sources: target.sourceFiles(withSuffix: "swift").map(\.path),
            work: context.pluginWorkDirectory,
            executable: context.tool(named: "harness-swift-lint").path
        )]
    }

    func command(root: Path, target: String, sources: [Path], work: Path, executable: Path) throws -> Command {
        let config = root.appending("harness-swift.json")
        let report = work.appending("harness-report.json")
        var arguments = ["--config", config.string, "--target", target, "--root", root.string, "--report", report.string]
        for source in sources { arguments += ["--source", source.string] }
        return .buildCommand(
            displayName: "Harness Swift: \(target)", executable: executable, arguments: arguments,
            inputFiles: sources + [config], outputFiles: [report]
        )
    }
}

#if canImport(XcodeProjectPlugin)
import XcodeProjectPlugin
extension HarnessBuildPlugin: XcodeBuildToolPlugin {
    func createBuildCommands(context: XcodePluginContext, target: XcodeTarget) throws -> [Command] {
        return [try command(
            root: context.xcodeProject.directory,
            target: target.displayName,
            sources: target.inputFiles.filter { $0.path.extension == "swift" }.map(\.path),
            work: context.pluginWorkDirectory,
            executable: context.tool(named: "harness-swift-lint").path
        )]
    }
}
#endif
