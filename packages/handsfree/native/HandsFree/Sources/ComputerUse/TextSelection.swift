import CoreFoundation
import Foundation

enum TextSelectionMode: String {
    case text
    case cursorBefore = "cursor_before"
    case cursorAfter = "cursor_after"

    init(skyValue: String?) {
        self = skyValue.flatMap(TextSelectionMode.init(rawValue:)) ?? .text
    }
}

enum TextSelectionResolver {
    static func range(
        value: String,
        text: String,
        prefix: String?,
        suffix: String?,
        selection: TextSelectionMode
    ) -> CFRange? {
        guard !text.isEmpty else { return nil }
        let source = value as NSString
        let target = text as NSString
        var candidates: [NSRange] = []
        var search = NSRange(location: 0, length: source.length)

        while search.location <= source.length {
            let match = source.range(of: target as String, options: [], range: search)
            if match.location == NSNotFound { break }
            if contextMatches(source: source, match: match, prefix: prefix, suffix: suffix) {
                candidates.append(match)
            }
            let nextLocation = match.location + max(match.length, 1)
            guard nextLocation <= source.length else { break }
            search = NSRange(location: nextLocation, length: source.length - nextLocation)
        }

        guard candidates.count == 1, let match = candidates.first else { return nil }
        switch selection {
        case .text:
            return CFRange(location: match.location, length: match.length)
        case .cursorBefore:
            return CFRange(location: match.location, length: 0)
        case .cursorAfter:
            return CFRange(location: match.location + match.length, length: 0)
        }
    }

    private static func contextMatches(
        source: NSString,
        match: NSRange,
        prefix: String?,
        suffix: String?
    ) -> Bool {
        if let prefix {
            let context = prefix as NSString
            guard match.location >= context.length else { return false }
            let range = NSRange(location: match.location - context.length, length: context.length)
            guard source.substring(with: range) == prefix else { return false }
        }
        if let suffix {
            let context = suffix as NSString
            let location = match.location + match.length
            guard location + context.length <= source.length else { return false }
            let range = NSRange(location: location, length: context.length)
            guard source.substring(with: range) == suffix else { return false }
        }
        return true
    }
}
