import CoreGraphics
import Foundation

struct SkyElementTarget: Equatable {
    let ref: String?
    let index: Int?
}

enum ComputerMouseButton: String, Equatable {
    case left
    case right
    case middle

    var cgButton: CGMouseButton {
        switch self {
        case .left: return .left
        case .right: return .right
        case .middle: return .center
        }
    }

    var downEventType: CGEventType {
        switch self {
        case .left: return .leftMouseDown
        case .right: return .rightMouseDown
        case .middle: return .otherMouseDown
        }
    }

    var upEventType: CGEventType {
        switch self {
        case .left: return .leftMouseUp
        case .right: return .rightMouseUp
        case .middle: return .otherMouseUp
        }
    }

    var dragEventType: CGEventType {
        switch self {
        case .left: return .leftMouseDragged
        case .right: return .rightMouseDragged
        case .middle: return .otherMouseDragged
        }
    }
}

enum MouseInputGeometry {
    static func clickCount(_ requested: Int) -> Int {
        max(1, min(requested, 4))
    }

    static func linearPath(from: CGPoint, to: CGPoint, segments: Int = 12) -> [CGPoint] {
        let count = max(1, segments)
        return (0...count).map { step in
            let progress = CGFloat(step) / CGFloat(count)
            return CGPoint(
                x: from.x + (to.x - from.x) * progress,
                y: from.y + (to.y - from.y) * progress
            )
        }
    }

    static func scrollLines(pages: Double) -> Int32 {
        max(1, Int32((pages * 5).rounded()))
    }
}

enum SkyCompatibility {
    static func elementTarget(_ raw: String?) -> SkyElementTarget {
        guard let raw else { return SkyElementTarget(ref: nil, index: nil) }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let index = Int(value) {
            return SkyElementTarget(ref: nil, index: index)
        }
        if value.hasPrefix("{e"), value.hasSuffix("}") {
            return SkyElementTarget(ref: value, index: nil)
        }
        if value.lowercased().hasPrefix("e"), Int(value.dropFirst()) != nil {
            return SkyElementTarget(ref: "{\(value.lowercased())}", index: nil)
        }
        return SkyElementTarget(ref: value.isEmpty ? nil : value, index: nil)
    }

    static func keyCombo(_ raw: String) -> String {
        raw.split(separator: "+", omittingEmptySubsequences: false)
            .map { part in
                let normalized = part.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                return normalized == "super" ? "command" : normalized
            }
            .joined(separator: "+")
    }

    static func mouseButton(_ raw: String?) -> ComputerMouseButton? {
        guard let raw else { return .left }
        return ComputerMouseButton(rawValue: raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }
}
