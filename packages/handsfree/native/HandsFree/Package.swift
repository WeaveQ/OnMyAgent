// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "HandsFree",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "HandsFreeComputerUse",
            path: "Sources/ComputerUse"
        ),
        .testTarget(
            name: "ComputerUseTests",
            dependencies: ["HandsFreeComputerUse"],
            path: "Tests/ComputerUseTests"
        ),
    ]
)
