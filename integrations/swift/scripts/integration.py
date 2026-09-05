#!/usr/bin/env python3
"""Native build integration checks using a detached package distribution and consumers."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

PACKAGE = Path(__file__).resolve().parents[1]

def run(command, cwd, expect=True, contains=None):
    result = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if (result.returncode == 0) != expect or (contains and contains not in result.stdout):
        raise AssertionError(f"{command} returned {result.returncode}\n{result.stdout}")
    return result.stdout

def config(root, forbidden):
    (root / 'harness-swift.json').write_text(json.dumps({'version': 1, 'targets': {'App': {'forbiddenImports': forbidden}}}))

def verify(command, root):
    config(root, [])
    run(command, root)
    config(root, ['Foundation'])
    run(command, root, expect=False, contains='swift/forbidden-import')
    config(root, [])
    run(command, root)
    (root / 'harness-swift.json').unlink()
    run(command, root, expect=False, contains='harness-swift.json')
    config(root, ['Dispatch'])
    run(command, root)
    (root / 'App.swift').write_text('import Foundation\nimport Dispatch\npublic let value = 1\n')
    failed = run(command, root, expect=False, contains='swift/forbidden-import')
    assert '"status" : "fail"' in failed
    assert '"file" : "App.swift"' in failed
    assert '"line" : 2' in failed

def xcode_project(root):
    project = root / 'App.xcodeproj'
    project.mkdir()
    # Minimal framework project: PBXTargetDependency attaches the package build plugin.
    (project / 'project.pbxproj').write_text('''// !$*UTF8*$!
{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {
A00000000000000000000001 = { isa = PBXProject; buildConfigurationList = A00000000000000000000002; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; mainGroup = A00000000000000000000003; productRefGroup = A00000000000000000000004; projectDirPath = ""; projectRoot = ""; targets = (A00000000000000000000005); packageReferences = (A00000000000000000000006); };
A00000000000000000000002 = { isa = XCConfigurationList; buildConfigurations = (A00000000000000000000007); defaultConfigurationIsVisible = 0; defaultConfigurationName = Debug; };
A00000000000000000000003 = { isa = PBXGroup; children = (A00000000000000000000008, A00000000000000000000004); sourceTree = "<group>"; };
A00000000000000000000004 = { isa = PBXGroup; children = (A00000000000000000000009); name = Products; sourceTree = "<group>"; };
A00000000000000000000005 = { isa = PBXNativeTarget; buildConfigurationList = A00000000000000000000002; buildPhases = (A0000000000000000000000A); buildRules = (); dependencies = (A0000000000000000000000B); name = App; productName = App; productReference = A00000000000000000000009; productType = "com.apple.product-type.framework"; };
A00000000000000000000006 = { isa = XCLocalSwiftPackageReference; relativePath = ../HarnessSwift; };
A00000000000000000000007 = { isa = XCBuildConfiguration; name = Debug; buildSettings = { SWIFT_VERSION = 5.0; PRODUCT_NAME = "$(TARGET_NAME)"; PRODUCT_BUNDLE_IDENTIFIER = dev.harness.App; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 15.0; GENERATE_INFOPLIST_FILE = YES; CODE_SIGNING_ALLOWED = NO; CLANG_ENABLE_MODULES = YES; DEFINES_MODULE = YES; }; };
A00000000000000000000008 = { isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = App.swift; sourceTree = "<group>"; };
A00000000000000000000009 = { isa = PBXFileReference; explicitFileType = wrapper.framework; path = App.framework; sourceTree = BUILT_PRODUCTS_DIR; };
A0000000000000000000000A = { isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A0000000000000000000000D); runOnlyForDeploymentPostprocessing = 0; };
A0000000000000000000000B = { isa = PBXTargetDependency; productRef = A0000000000000000000000C; };
A0000000000000000000000C = { isa = XCSwiftPackageProductDependency; package = A00000000000000000000006; productName = "plugin:HarnessBuildPlugin"; };
A0000000000000000000000D = { isa = PBXBuildFile; fileRef = A00000000000000000000008; };
}; rootObject = A00000000000000000000001; }
''')

with tempfile.TemporaryDirectory(prefix='harness-swift-') as directory:
    base = Path(directory)
    shutil.copytree(PACKAGE, base / 'HarnessSwift', ignore=shutil.ignore_patterns('.build', '.swiftpm', '.DS_Store'))
    swift = base / 'SwiftConsumer'
    swift.mkdir()
    (swift / 'App.swift').write_text('import Foundation\npublic let value = 1\n')
    (swift / 'Package.swift').write_text('''// swift-tools-version: 5.10
import PackageDescription
let package = Package(name: "Consumer", dependencies: [.package(name: "HarnessSwift", path: "../HarnessSwift")], targets: [.target(name: "App", path: ".", exclude: ["harness-swift.json"], sources: ["App.swift"], plugins: [.plugin(name: "HarnessBuildPlugin", package: "HarnessSwift")])])
''')
    verify(['swift', 'build'], swift)
    print('PASS SwiftPM: native builds, config invalidation, source invalidation, missing configuration')
    if shutil.which('xcodebuild') and os.environ.get('HARNESS_SKIP_XCODE') != '1':
        xcode = base / 'XcodeConsumer'
        xcode.mkdir()
        (xcode / 'App.swift').write_text('import Foundation\npublic let value = 1\n')
        xcode_project(xcode)
        verify(['xcodebuild', '-project', 'App.xcodeproj', '-scheme', 'App', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', str(base / 'DerivedData'), '-skipPackagePluginValidation', 'build'], xcode)
        print('PASS Xcode iOS Simulator: native builds, config invalidation, source invalidation, missing configuration')
    else:
        print('SKIP Xcode: unavailable or HARNESS_SKIP_XCODE=1')
