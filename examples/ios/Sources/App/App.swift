import Foundation

/// Shared by the native Xcode framework and SwiftPM consumer.
public struct Greeting {
    public init() {}

    public func message(for name: String) -> String {
        "Hello, \(name)!"
    }
}
