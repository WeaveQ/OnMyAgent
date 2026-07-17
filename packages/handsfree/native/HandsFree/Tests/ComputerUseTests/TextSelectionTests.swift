import Foundation
import XCTest
@testable import HandsFreeComputerUse

final class TextSelectionTests: XCTestCase {
    private func assertRange(
        _ actual: CFRange?,
        location: CFIndex,
        length: CFIndex,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertEqual(actual?.location, location, file: file, line: line)
        XCTAssertEqual(actual?.length, length, file: file, line: line)
    }

    func testSelectsUniqueTextUsingUTF16Offsets() {
        assertRange(
            TextSelectionResolver.range(
                value: "hello world",
                text: "world",
                prefix: nil,
                suffix: nil,
                selection: .text
            ),
            location: 6,
            length: 5
        )
    }

    func testRequiresContextForRepeatedText() {
        XCTAssertNil(
            TextSelectionResolver.range(
                value: "one two one",
                text: "one",
                prefix: nil,
                suffix: nil,
                selection: .text
            )
        )
        assertRange(
            TextSelectionResolver.range(
                value: "one two one",
                text: "one",
                prefix: "one two ",
                suffix: nil,
                selection: .text
            ),
            location: 8,
            length: 3
        )
    }

    func testSuffixDisambiguatesRepeatedText() {
        assertRange(
            TextSelectionResolver.range(
                value: "go left or go right",
                text: "go",
                prefix: nil,
                suffix: " right",
                selection: .text
            ),
            location: 11,
            length: 2
        )
    }

    func testEmojiOffsetsUseUTF16CodeUnits() {
        assertRange(
            TextSelectionResolver.range(
                value: "A😀B",
                text: "😀",
                prefix: nil,
                suffix: nil,
                selection: .text
            ),
            location: 1,
            length: 2
        )
        assertRange(
            TextSelectionResolver.range(
                value: "A😀B",
                text: "B",
                prefix: nil,
                suffix: nil,
                selection: .text
            ),
            location: 3,
            length: 1
        )
    }

    func testCursorModesCollapseTheResolvedRange() {
        assertRange(
            TextSelectionResolver.range(
                value: "alpha beta",
                text: "beta",
                prefix: nil,
                suffix: nil,
                selection: .cursorBefore
            ),
            location: 6,
            length: 0
        )
        assertRange(
            TextSelectionResolver.range(
                value: "alpha beta",
                text: "beta",
                prefix: nil,
                suffix: nil,
                selection: .cursorAfter
            ),
            location: 10,
            length: 0
        )
    }

    func testEmptyOrMissingTextDoesNotResolve() {
        XCTAssertNil(TextSelectionResolver.range(value: "alpha", text: "", prefix: nil, suffix: nil, selection: .text))
        XCTAssertNil(TextSelectionResolver.range(value: "alpha", text: "beta", prefix: nil, suffix: nil, selection: .text))
    }
}
