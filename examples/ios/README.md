# iOS native build example

This is an actual iOS framework project (`App.xcodeproj`) and a SwiftPM library
consumer sharing `Sources/App/App.swift`. Both attach `HarnessBuildPlugin` from
`../../integrations/swift` to the `App` target. The normal native build executes
the shared Swift lint rule; Node.js and the auxiliary Harness CLI are unnecessary.

The example's explicit architecture policy forbids `Dispatch` imports in `App`.
`Foundation` is allowed. This is a small demonstrable policy, not a suggested
restriction for all iOS applications.

## Build

From this directory, on macOS with Xcode installed and selected:

```sh
xcodebuild -project App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build -skipPackagePluginValidation build
```

The product is `build/Build/Products/Debug-iphonesimulator/App.framework`.
`-skipPackagePluginValidation` permits the local repository's trusted build plugin
to run noninteractively; when opening the project in Xcode, approve that plugin
instead. No signing account or running simulator is needed.

You can also verify the SwiftPM integration with Swift 5.10 or newer:

```sh
swift build
```

SwiftPM builds the shared library for its host; the Xcode command above proves
that the consumer builds for the iOS Simulator SDK.

## Prove that the build rejects a violation

Append `import Dispatch` to `Sources/App/App.swift`, then repeat either build.
It must fail with `swift/forbidden-import`, pointing to the changed source line.
Remove that import and repeat the build; it must succeed again.

The root example runner automates this success → violation → restored-success
sequence in an isolated copy. `example.json` declares the native command, source
mutation, expected diagnostic, product, and additional SwiftPM build.
