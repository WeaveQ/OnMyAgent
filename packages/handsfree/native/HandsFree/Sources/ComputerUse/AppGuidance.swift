import Foundation

enum AppGuidance {
    static func instructions(bundleIdentifier: String?, appName: String) -> String? {
        let identifier = bundleIdentifier?.lowercased() ?? ""
        let name = appName.lowercased()

        if identifier == "com.apple.music" || name == "music" || name == "apple music" {
            return """
            Search from the sidebar Search destination and set the main search field value; the in-view filter is not catalog search. Double-click a track to play it. Use the More menu or a right-click for Play Next or Play Last, and refresh app state before retrying navigation.
            """
        }
        if identifier == "com.apple.clock" || name == "clock" {
            return """
            Inspect the current timer, stopwatch, alarm, or world-clock state before changing it. Timer values are hours, minutes, and seconds with a maximum of 23:59:59; focus each time field and type its value. Confirm existing running timers or stopwatches with the user before replacing their state.
            """
        }
        if identifier == "notion.id" || name == "notion" {
            return """
            Notion pages are block based. Press Return to edit a selected block and enter content one line at a time. Empty titles and blocks expose placeholder text; type into them without deleting the placeholder. Refresh app state after selection changes because Command-A behavior depends on the current block state.
            """
        }
        if identifier == "com.apple.numbers" || name == "numbers" {
            return """
            Click a cell once to append or three times to replace its current value, then type. Tab-delimited input can fill one row at a time; do not submit multiple rows or multiple formulas in one type_text call. Values save immediately.
            """
        }
        if identifier == "com.tinyspeck.slackmacgap" || name == "slack" {
            return """
            Slack may route typing to the message composer when no field is focused. Verify that the intended composer is focused before typing and before Return, because Return can send the message. Use the screenshot when the accessibility tree is ambiguous.
            """
        }
        if identifier == "com.spotify.client" || name == "spotify" {
            return """
            Spotify playback and search results can update asynchronously. Request a fresh app state before retrying a playback action or changing course after a temporary no-results state. Focus the search field before Return so it does not affect playback.
            """
        }
        if identifier == "com.apple.screencontinuity" || name == "iphone mirroring" {
            return """
            In iPhone Mirroring, use ⌘1 for Home Screen, ⌘2 for App Switcher, and ⌘3 for Spotlight. Scroll with the scroll tool rather than dragging, and click the center of a Home Screen icon instead of its label.
            """
        }
        return nil
    }
}
