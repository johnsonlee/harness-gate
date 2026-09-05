import XCTest
@testable import HarnessRules

final class RulesTests: XCTestCase {
    func testImportsAndLocations() {
        let source = "import Foundation\n@testable import Storage\nimport struct Storage.Item\n"
        let result = SwiftRules.check(source: source, file: "App.swift", rules: .init(forbiddenImports: ["Storage"]))
        XCTAssertEqual(result.map(\.line), [2, 3])
        XCTAssertEqual(result.map(\.ruleId), ["swift/forbidden-import", "swift/forbidden-import"])
    }
    func testCommentsAndStrings() {
        let source = ##"""
        // import Storage
        /* outer /* import Storage */
        import Storage
        */
        let a = "import Storage"
        let b = #"import Storage"#
        let c = """
        import Storage
        """
        let regex = #/
        import Storage
        /#
        import Foundation
        """##
        XCTAssertTrue(SwiftRules.check(source: source, file: "A.swift", rules: .init(forbiddenImports: ["Storage"])).isEmpty)
    }
    func testBoundaryAndConditionalImports() {
        let source = "#if os(iOS)\nimport UIKit\n#endif\nimport Foundation; import Storage"
        let result = SwiftRules.check(source: source, file: "App.swift", rules: .init(forbiddenImports: [], allowedImports: ["Foundation"]))
        XCTAssertEqual(result.count, 2)
        XCTAssertTrue(result.allSatisfy { $0.ruleId == "swift/module-boundary" })
    }
    func testUnicodeAndEscapedModuleNames() {
        let result = SwiftRules.check(source: "import 数据\nimport `Storage`", file: "App.swift", rules: .init(forbiddenImports: ["数据", "Storage"]))
        XCTAssertEqual(result.count, 2)
    }
    func testConfigurationFailsClosed() throws {
        let data = Data(#"{"version":1,"targets":{"App":{"forbiddenImports":[]}}}"#.utf8)
        let configuration = try JSONDecoder().decode(Configuration.self, from: data)
        XCTAssertNoThrow(try configuration.validate(target: "App"))
        XCTAssertThrowsError(try configuration.validate(target: "Other"))
        let unsupported = try JSONDecoder().decode(Configuration.self, from: Data(#"{"version":2,"targets":{}}"#.utf8))
        XCTAssertThrowsError(try unsupported.validate(target: "App"))
    }
}
