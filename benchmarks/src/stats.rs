/// Statistical utilities for benchmark result analysis.
/// All functions operate on sorted slices to guarantee deterministic output.

/// Returns (median, q1, q3, p95, p99) from a mutable slice of f64 values.
/// The slice is sorted in-place.
pub fn compute_stats(data: &mut [f64]) -> Stats {
    assert!(!data.is_empty(), "Cannot compute statistics on empty data");
    data.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let n = data.len();
    let median = percentile_sorted(data, 50.0);
    let q1 = percentile_sorted(data, 25.0);
    let q3 = percentile_sorted(data, 75.0);
    let p95 = percentile_sorted(data, 95.0);
    let p99 = percentile_sorted(data, 99.0);
    let min = data[0];
    let max = data[n - 1];

    Stats { median, q1, q3, p95, p99, min, max, count: n }
}

/// Linear interpolation percentile on a pre-sorted slice.
fn percentile_sorted(sorted: &[f64], pct: f64) -> f64 {
    let n = sorted.len();
    if n == 1 {
        return sorted[0];
    }
    let rank = (pct / 100.0) * (n - 1) as f64;
    let lo = rank.floor() as usize;
    let hi = rank.ceil() as usize;
    let frac = rank - lo as f64;
    sorted[lo] * (1.0 - frac) + sorted[hi] * frac
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Stats {
    pub median: f64,
    pub q1: f64,
    pub q3: f64,
    pub p95: f64,
    pub p99: f64,
    pub min: f64,
    pub max: f64,
    pub count: usize,
}

impl std::fmt::Display for Stats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "n={} | median={:.1} | IQR=[{:.1}, {:.1}] | p95={:.1} | p99={:.1} | range=[{:.1}, {:.1}]",
            self.count, self.median, self.q1, self.q3, self.p95, self.p99, self.min, self.max
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_stats() {
        let mut data: Vec<f64> = (1..=100).map(|x| x as f64).collect();
        let s = compute_stats(&mut data);
        assert!((s.median - 50.5).abs() < 0.1);
        assert!((s.q1 - 25.75).abs() < 0.5);
        assert!((s.p99 - 99.01).abs() < 0.5);
    }
}
