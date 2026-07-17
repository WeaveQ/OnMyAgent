import Foundation

enum UISettleDecision: Equatable, Sendable {
    case waiting
    case settled
    case timedOut
}

struct UISettleState: Sendable {
    private let baseline: TimeInterval
    private let debounce: TimeInterval
    private let timeout: TimeInterval
    private var lastFingerprint: Int?
    private var stableSince: TimeInterval = 0

    init(baseline: TimeInterval = 1, debounce: TimeInterval = 0.25, timeout: TimeInterval = 5) {
        self.baseline = baseline
        self.debounce = debounce
        self.timeout = timeout
    }

    mutating func observe(elapsed: TimeInterval, fingerprint: Int, isLoading: Bool) -> UISettleDecision {
        if elapsed >= timeout { return .timedOut }
        if lastFingerprint != fingerprint {
            lastFingerprint = fingerprint
            stableSince = elapsed
        }
        guard elapsed >= baseline, !isLoading else { return .waiting }
        if stableSince == 0 || elapsed - stableSince >= debounce { return .settled }
        return .waiting
    }
}

struct UISettleObservation: Sendable {
    let fingerprint: Int
    let isLoading: Bool
}

struct UISettleOutcome: Sendable {
    let decision: UISettleDecision
    let duration: TimeInterval
    let samples: Int

    var dictionary: [String: Any] {
        [
            "status": decision == .timedOut ? "timed_out" : "settled",
            "durationMs": Int((duration * 1_000).rounded()),
            "samples": samples,
        ]
    }
}

enum UISettler {
    static func settle(
        observe: @escaping @Sendable () throws -> UISettleObservation
    ) async throws -> UISettleOutcome {
        let clock = ContinuousClock()
        let started = clock.now
        var state = UISettleState()
        var samples = 0

        while true {
            try Task.checkCancellation()
            let observation = try observe()
            samples += 1
            let duration = started.duration(to: clock.now).components
            let elapsed = Double(duration.seconds)
                + Double(duration.attoseconds) / 1_000_000_000_000_000_000
            let decision = state.observe(
                elapsed: elapsed,
                fingerprint: observation.fingerprint,
                isLoading: observation.isLoading
            )
            if decision != .waiting {
                return UISettleOutcome(decision: decision, duration: elapsed, samples: samples)
            }
            try await Task.sleep(for: .milliseconds(100))
        }
    }
}
