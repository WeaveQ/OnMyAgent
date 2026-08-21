import CoreGraphics
import Foundation

enum BackgroundInputDispatcher {
    static func primeMouse(
        pid: pid_t,
        windowNumber: Int,
        windowBounds: CGRect,
        point: CGPoint,
        bridge: SkyLightBridge
    ) throws {
        guard let source = CGEventSource(stateID: .hidSystemState),
              let event = CGEvent(
                mouseEventSource: source,
                mouseType: .mouseMoved,
                mouseCursorPosition: point,
                mouseButton: .left
              ) else {
            throw ComputerUseError.eventCreationFailed
        }
        try bridge.postMouse(
            event,
            pid: pid,
            windowNumber: windowNumber,
            screenPoint: point,
            windowBounds: windowBounds,
            clickState: 1,
            buttonNumber: 0,
            subtype: 3,
            publicRoute: true
        )
    }

    static func click(
        pid: pid_t,
        windowNumber: Int,
        windowBounds: CGRect,
        point: CGPoint,
        button: ComputerMouseButton = .left,
        clickCount requestedClickCount: Int = 1,
        bridge: SkyLightBridge
    ) async throws {
        guard let source = CGEventSource(stateID: .hidSystemState) else {
            throw ComputerUseError.eventSourceFailed
        }

        let clickCount = MouseInputGeometry.clickCount(requestedClickCount)
        for clickState in 1...clickCount {
            guard let down = CGEvent(
                mouseEventSource: source,
                mouseType: button.downEventType,
                mouseCursorPosition: point,
                mouseButton: button.cgButton
            ), let up = CGEvent(
                mouseEventSource: source,
                mouseType: button.upEventType,
                mouseCursorPosition: point,
                mouseButton: button.cgButton
            ) else {
                throw ComputerUseError.eventCreationFailed
            }

            try bridge.postMouse(
                down,
                pid: pid,
                windowNumber: windowNumber,
                screenPoint: point,
                windowBounds: windowBounds,
                clickState: Int64(clickState),
                buttonNumber: button.number,
                subtype: 3,
                dualRoute: true
            )
            try await Task.sleep(for: .milliseconds(1))
            try bridge.postMouse(
                up,
                pid: pid,
                windowNumber: windowNumber,
                screenPoint: point,
                windowBounds: windowBounds,
                clickState: Int64(clickState),
                buttonNumber: button.number,
                subtype: 3
            )

            if clickState < clickCount {
                try await Task.sleep(for: .milliseconds(80))
            }
        }
    }

    static func drag(
        pid: pid_t,
        windowNumber: Int,
        windowBounds: CGRect,
        path: [CGPoint],
        button: ComputerMouseButton = .left,
        bridge: SkyLightBridge
    ) async throws {
        guard path.count >= 2,
              let first = path.first,
              let last = path.last,
              let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(
                mouseEventSource: source,
                mouseType: button.downEventType,
                mouseCursorPosition: first,
                mouseButton: button.cgButton
              ),
              let up = CGEvent(
                mouseEventSource: source,
                mouseType: button.upEventType,
                mouseCursorPosition: last,
                mouseButton: button.cgButton
              ) else {
            throw ComputerUseError.eventCreationFailed
        }

        try bridge.postMouse(
            down,
            pid: pid,
            windowNumber: windowNumber,
            screenPoint: first,
            windowBounds: windowBounds,
            clickState: 1,
            buttonNumber: button.number,
            subtype: 3,
            dualRoute: true
        )
        try await Task.sleep(for: .milliseconds(12))

        var previousPoint = first
        for point in path.dropFirst() {
            guard let drag = CGEvent(
                mouseEventSource: source,
                mouseType: button.dragEventType,
                mouseCursorPosition: point,
                mouseButton: button.cgButton
            ) else {
                throw ComputerUseError.eventCreationFailed
            }
            drag.setIntegerValueField(.mouseEventDeltaX, value: Int64((point.x - previousPoint.x).rounded()))
            drag.setIntegerValueField(.mouseEventDeltaY, value: Int64((point.y - previousPoint.y).rounded()))
            try bridge.postMouse(
                drag,
                pid: pid,
                windowNumber: windowNumber,
                screenPoint: point,
                windowBounds: windowBounds,
                clickState: 1,
                buttonNumber: button.number,
                subtype: 3
            )
            try await Task.sleep(for: .milliseconds(12))
            previousPoint = point
        }

        try bridge.postMouse(
            up,
            pid: pid,
            windowNumber: windowNumber,
            screenPoint: last,
            windowBounds: windowBounds,
            clickState: 1,
            buttonNumber: button.number,
            subtype: 3
        )
    }

    static func scroll(
        pid: pid_t,
        windowNumber: Int,
        windowBounds: CGRect,
        point: CGPoint,
        deltaX: Int32,
        deltaY: Int32,
        bridge: SkyLightBridge
    ) throws {
        guard let source = CGEventSource(stateID: .hidSystemState),
              let event = CGEvent(
                scrollWheelEvent2Source: source,
                units: .pixel,
                wheelCount: 2,
                wheel1: deltaY,
                wheel2: deltaX,
                wheel3: 0
              ) else {
            throw ComputerUseError.eventCreationFailed
        }
        try bridge.postMouse(
            event,
            pid: pid,
            windowNumber: windowNumber,
            screenPoint: point,
            windowBounds: windowBounds,
            clickState: 0,
            buttonNumber: 0,
            subtype: 0
        )
    }

    static func typeText(
        pid: pid_t,
        windowNumber: Int,
        text: String,
        bridge: SkyLightBridge
    ) throws {
        guard let source = CGEventSource(stateID: .hidSystemState) else {
            throw ComputerUseError.eventSourceFailed
        }

        for character in text {
            let units = Array(String(character).utf16)
            let keyCode = textKeyCode(for: character)
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
                throw ComputerUseError.eventCreationFailed
            }
            down.flags = []
            up.flags = []
            down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            try bridge.postKeyboard(down, pid: pid, windowNumber: windowNumber)
            try bridge.postKeyboard(up, pid: pid, windowNumber: windowNumber)
        }
    }

    static func pressKey(
        pid: pid_t,
        windowNumber: Int,
        combo: String,
        bridge: SkyLightBridge
    ) throws {
        let parsed = try parseCombo(combo)
        guard let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: parsed.keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: parsed.keyCode, keyDown: false) else {
            throw ComputerUseError.eventCreationFailed
        }

        down.flags = parsed.flags
        up.flags = parsed.flags
        try bridge.postKeyboard(down, pid: pid, windowNumber: windowNumber)
        try bridge.postKeyboard(up, pid: pid, windowNumber: windowNumber)
    }

    static func parseCombo(_ combo: String) throws -> (flags: CGEventFlags, keyCode: CGKeyCode) {
        let parts = combo.lowercased().split(separator: "+").map(String.init)
        var flags: CGEventFlags = []
        var keyName = ""

        for part in parts {
            switch part {
            case "command", "cmd", "meta", "super": flags.insert(.maskCommand)
            case "shift": flags.insert(.maskShift)
            case "control", "ctrl": flags.insert(.maskControl)
            case "option", "alt": flags.insert(.maskAlternate)
            default: keyName = part
            }
        }

        guard let keyCode = keyCodes[keyName] else {
            throw ComputerUseError.unknownKey(keyName)
        }
        return (flags, keyCode)
    }

    private static func textKeyCode(for character: Character) -> CGKeyCode {
        let normalized = String(character).lowercased()
        return keyCodes[normalized] ?? 0
    }

    private static let keyCodes: [String: CGKeyCode] = [
        "return": 0x24, "enter": 0x24, "tab": 0x30, "space": 0x31, " ": 0x31,
        "delete": 0x33, "backspace": 0x33, "escape": 0x35, "esc": 0x35,
        "up": 0x7E, "down": 0x7D, "left": 0x7B, "right": 0x7C,
        "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
        "a": 0x00, "b": 0x0B, "c": 0x08, "d": 0x02, "e": 0x0E,
        "f": 0x03, "g": 0x05, "h": 0x04, "i": 0x22, "j": 0x26,
        "k": 0x28, "l": 0x25, "m": 0x2E, "n": 0x2D, "o": 0x1F,
        "p": 0x23, "q": 0x0C, "r": 0x0F, "s": 0x01, "t": 0x11,
        "u": 0x20, "v": 0x09, "w": 0x0D, "x": 0x07, "y": 0x10, "z": 0x06,
        "0": 0x1D, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15,
        "5": 0x17, "6": 0x16, "7": 0x1A, "8": 0x1C, "9": 0x19,
        "kp_0": 0x52, "kp_1": 0x53, "kp_2": 0x54, "kp_3": 0x55, "kp_4": 0x56,
        "kp_5": 0x57, "kp_6": 0x58, "kp_7": 0x59, "kp_8": 0x5B, "kp_9": 0x5C,
        "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76,
        "f5": 0x60, "f6": 0x61, "f7": 0x62, "f8": 0x64,
        "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
        "-": 0x1B, "=": 0x18, "[": 0x21, "]": 0x1E,
        "\\": 0x2A, ";": 0x29, "'": 0x27, ",": 0x2B,
        ".": 0x2F, "/": 0x2C, "`": 0x32,
    ]
}

private extension ComputerMouseButton {
    var number: Int64 {
        switch self {
        case .left: return 0
        case .right: return 1
        case .middle: return 2
        }
    }
}
