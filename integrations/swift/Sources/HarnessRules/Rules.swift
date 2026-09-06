import Foundation

public struct Configuration: Codable {
    public let version: Int
    public let targets: [String: TargetRules]
    public func validate(target: String) throws -> TargetRules {
        guard version == 1 else { throw RuleError.invalid("Unsupported configuration version \(version)") }
        guard let rules = targets[target] else { throw RuleError.invalid("Missing rules for target \(target)") }
        return rules
    }
}

public struct TargetRules: Codable {
    public let forbiddenImports: [String]
    public let allowedImports: [String]?
    public init(forbiddenImports: [String], allowedImports: [String]? = nil) {
        self.forbiddenImports = forbiddenImports
        self.allowedImports = allowedImports
    }
}

public enum RuleError: Error, CustomStringConvertible {
    case invalid(String)
    public var description: String { switch self { case .invalid(let message): return message } }
}

public struct Finding: Codable, Equatable {
    public let ruleId: String
    public let severity: String
    public let message: String
    public let file: String
    public let line: Int
}

public struct Report: Encodable {
    public let version = 1
    public let checkId: String
    public let status: String
    public let findings: [Finding]
    public init(checkId: String, status: String, findings: [Finding]) {
        self.checkId = checkId; self.status = status; self.findings = findings
    }
}

public enum SwiftRules {
    /// Masks comments and Swift string literals while preserving line positions.
    /// No semantic compiler resolution is performed; conditional imports are all checked.
    public static func check(source: String, file: String, rules: TargetRules) -> [Finding] {
        let clean = mask(source)
        let expression = try! NSRegularExpression(pattern: #"(?m)(?:^|;)[ \t]*(?:@[A-Za-z_][A-Za-z_0-9]*(?:\([^\n)]*\))?[ \t]*)*(?:public[ \t]+|internal[ \t]+|private[ \t]+|fileprivate[ \t]+|package[ \t]+)?import\s+(?:(?:typealias|struct|class|enum|protocol|let|var|func)\s+)?(`[^`\r\n]+`|[^\s.;/()]+)"#)
        let text = clean as NSString
        return expression.matches(in: clean, range: NSRange(location: 0, length: text.length)).compactMap { match in
            let module = text.substring(with: match.range(at: 1)).replacingOccurrences(of: "`", with: "")
            let forbidden = rules.forbiddenImports.contains(module)
            let outside = rules.allowedImports.map { !$0.contains(module) } ?? false
            guard forbidden || outside else { return nil }
            let line = text.substring(to: match.range(at: 1).location).filter { $0 == "\n" }.count + 1
            return Finding(ruleId: forbidden ? "swift/forbidden-import" : "swift/module-boundary", severity: "error", message: "Import of \(module) is not permitted", file: file, line: line)
        }
    }

    private static func mask(_ source: String) -> String {
        let chars = Array(source)
        var result = chars
        var i = 0
        func has(_ value: String, _ at: Int) -> Bool {
            let part = Array(value)
            return at + part.count <= chars.count && Array(chars[at..<(at + part.count)]) == part
        }
        func blank(_ start: Int, _ end: Int) {
            for j in start..<end where chars[j] != "\n" && chars[j] != "\r" { result[j] = " " }
        }
        while i < chars.count {
            let start = i
            if has("//", i) {
                while i < chars.count && chars[i] != "\n" { i += 1 }
                blank(start, i)
            } else if has("/*", i) {
                var depth = 1; i += 2
                while i < chars.count && depth > 0 {
                    if has("/*", i) { depth += 1; i += 2 }
                    else if has("*/", i) { depth -= 1; i += 2 }
                    else { i += 1 }
                }
                blank(start, i)
            } else {
                var hashes = 0
                while i + hashes < chars.count && chars[i + hashes] == "#" { hashes += 1 }
                let quote = i + hashes
                if quote < chars.count && chars[quote] == "\"" {
                    let width = has("\"\"\"", quote) ? 3 : 1
                    let closing = String(repeating: "\"", count: width) + String(repeating: "#", count: hashes)
                    let escape = "\\" + String(repeating: "#", count: hashes)
                    i = quote + width
                    while i < chars.count {
                        if has(escape, i) { i = min(chars.count, i + hashes + 2) }
                        else if has(closing, i) { i += width + hashes; break }
                        else { i += 1 }
                    }
                    blank(start, i)
                } else if hashes > 0 && quote < chars.count && chars[quote] == "/" {
                    // Extended regex literals may span lines and contain import-looking text.
                    let closing = "/" + String(repeating: "#", count: hashes)
                    i = quote + 1
                    while i < chars.count && !has(closing, i) { i += 1 }
                    i = min(chars.count, i + closing.count)
                    blank(start, i)
                } else { i += 1 }
            }
        }
        return String(result)
    }
}
