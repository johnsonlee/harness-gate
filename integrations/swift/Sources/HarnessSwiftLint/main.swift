import Foundation
import HarnessRules

var arguments = Array(CommandLine.arguments.dropFirst())
var options: [String: String] = [:]
var files: [String] = []
var target = "unknown"
var exitCode: Int32 = 0
var findings: [Finding] = []
var status = "error"
do {
    while !arguments.isEmpty {
        let key = arguments.removeFirst()
        guard key.hasPrefix("--"), !arguments.isEmpty else { throw RuleError.invalid("Expected --config, --target, --root, --report and repeated --source arguments") }
        let value = arguments.removeFirst()
        if key == "--source" { files.append(value) }
        else if ["--config", "--target", "--root", "--report"].contains(key), options[key] == nil { options[key] = value }
        else { throw RuleError.invalid("Unknown or duplicate option \(key)") }
    }
    guard let config = options["--config"], let selected = options["--target"], let root = options["--root"] else {
        throw RuleError.invalid("--config, --target and --root are required")
    }
    target = selected
    let configuration = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: URL(fileURLWithPath: config)))
    let rules = try configuration.validate(target: target)
    let prefix = URL(fileURLWithPath: root).standardizedFileURL.path + "/"
    for path in files.sorted() {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.path.hasPrefix(prefix) else { throw RuleError.invalid("Source outside project root: \(path)") }
        let relative = String(url.path.dropFirst(prefix.count))
        findings += SwiftRules.check(source: try String(contentsOf: url, encoding: .utf8), file: relative, rules: rules)
    }
    status = findings.isEmpty ? "pass" : "fail"
    exitCode = findings.isEmpty ? 0 : 1
    for finding in findings {
        fputs("\(finding.file):\(finding.line): error: [\(finding.ruleId)] \(finding.message)\n", stderr)
    }
} catch {
    fputs("Harness Swift: error: \(error)\n", stderr)
    exitCode = 2
}
let report = Report(checkId: "swift:\(target)", status: status, findings: findings)
do {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(report)
    if let path = options["--report"] {
        let url = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    fputs("Harness Swift: error: cannot write report: \(error)\n", stderr)
    exitCode = 2
}
exit(exitCode)
