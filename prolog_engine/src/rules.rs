//! User-rule loading helpers.
//!
//! Rules are persisted as plain `.pl` files attached to `digital` entities
//! tagged with the `rule` abstract entity. This module only deals with the
//! Prolog-side concerns: detecting the head signature of a rule body so the
//! GUI can offer it as an inference target, and asserting/retracting clauses
//! against the live machine.

use crate::ScryerMachine;

/// The functor + arity of the predicate a rule defines. Detected from the
/// rule body so the GUI knows which head to query.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct HeadSignature {
    pub functor: String,
    pub arity: usize,
}

/// Parses a rule body and returns the head signature.
///
/// Detection order:
/// 1. Optional override directive: a comment line of the form
///    `% @head <functor>/<arity>` anywhere in the body. Wins if present.
/// 2. The first non-comment, non-directive clause's head functor + arity.
///
/// Returns `Err` if the body has no detectable head clause.
pub fn detect_head(body: &str) -> Result<HeadSignature, String> {
    if let Some(sig) = scan_directive(body) {
        return Ok(sig);
    }
    scan_first_clause(body).ok_or_else(|| {
        "could not detect a head clause: rule must contain at least one fact or rule clause"
            .to_string()
    })
}

fn scan_directive(body: &str) -> Option<HeadSignature> {
    for line in body.lines() {
        let trimmed = line.trim_start();
        if !trimmed.starts_with('%') {
            continue;
        }
        let rest = trimmed.trim_start_matches('%').trim_start();
        let Some(rest) = rest.strip_prefix("@head") else { continue };
        let rest = rest.trim();
        let (functor, arity) = rest.split_once('/')?;
        let functor = functor.trim().to_string();
        let arity: usize = arity.trim().parse().ok()?;
        if functor.is_empty() {
            continue;
        }
        return Some(HeadSignature { functor, arity });
    }
    None
}

fn scan_first_clause(body: &str) -> Option<HeadSignature> {
    // Strip line comments and find the first identifier followed by `(`,
    // tracking arity by counting top-level commas inside the parenthesized
    // argument list. Honors quoted atoms so `,` inside `'a, b'` doesn't
    // inflate the arity.
    let mut chars = body.chars().peekable();
    let mut buf = String::new();

    // Skip leading whitespace, comments, and directives.
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else if c == '%' {
            while let Some(c) = chars.next() {
                if c == '\n' {
                    break;
                }
            }
        } else if c == ':' {
            // Could be a directive `:- ...`. Skip until end of clause.
            while let Some(c) = chars.next() {
                if c == '.' {
                    break;
                }
            }
        } else {
            break;
        }
    }

    while let Some(&c) = chars.peek() {
        if c.is_ascii_alphanumeric() || c == '_' {
            buf.push(c);
            chars.next();
        } else {
            break;
        }
    }

    if buf.is_empty() {
        return None;
    }

    // Skip whitespace between functor and `(`.
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else {
            break;
        }
    }

    // No paren → 0-arity head.
    if chars.peek() != Some(&'(') {
        return Some(HeadSignature {
            functor: buf,
            arity: 0,
        });
    }
    chars.next(); // consume '('

    let mut depth: i32 = 1;
    let mut commas: usize = 0;
    let mut in_single = false;
    while let Some(c) = chars.next() {
        if in_single {
            if c == '\\' {
                chars.next();
                continue;
            }
            if c == '\'' {
                in_single = false;
            }
            continue;
        }
        match c {
            '\'' => in_single = true,
            '(' | '[' => depth += 1,
            ')' | ']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(HeadSignature {
                        functor: buf,
                        arity: commas + 1,
                    });
                }
            }
            ',' if depth == 1 => commas += 1,
            _ => {}
        }
    }
    None
}

/// A wildcard pattern matching every clause of the given head, suitable for
/// `retractall/1`. `head_pattern("near", 2)` returns `"near(_, _)"`.
pub fn head_pattern(functor: &str, arity: usize) -> String {
    if arity == 0 {
        return functor.to_string();
    }
    let args: Vec<&str> = std::iter::repeat("_").take(arity).collect();
    format!("{}({})", functor, args.join(", "))
}

/// Asserts the body into the live machine. Wraps the existing
/// `ingest_facts` clause-aware splitter so a multi-clause rule is loaded
/// as a single transaction from the caller's perspective.
pub fn enable(machine: &ScryerMachine, body: &str) -> Result<(), String> {
    machine.ingest_facts(body)
}

/// Retracts every clause matching the given head signature.
pub fn disable(machine: &ScryerMachine, head: &HeadSignature) -> Result<(), String> {
    machine.retract_all(&head_pattern(&head.functor, head.arity))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_simple_two_arity_head() {
        let body = "near(X, Y) :- spatial_trait(_, X, _, _, _, _, _, _).";
        let h = detect_head(body).unwrap();
        assert_eq!(h.functor, "near");
        assert_eq!(h.arity, 2);
    }

    #[test]
    fn directive_overrides_first_clause() {
        let body = "% @head connected/2\nhelper(X) :- entity(X, _, _, _).\nconnected(A, B) :- helper(A), helper(B).";
        let h = detect_head(body).unwrap();
        assert_eq!(h.functor, "connected");
        assert_eq!(h.arity, 2);
    }

    #[test]
    fn skips_directive_clauses() {
        let body = ":- use_module(library(lists)).\nfoo(X, Y) :- entity(X, _, Y, _).";
        let h = detect_head(body).unwrap();
        assert_eq!(h.functor, "foo");
        assert_eq!(h.arity, 2);
    }

    #[test]
    fn nested_parens_dont_inflate_arity() {
        let body = "wrap(X, Y) :- pair((X, Y), Z).";
        let h = detect_head(body).unwrap();
        assert_eq!(h.arity, 2);
    }

    #[test]
    fn quoted_comma_doesnt_inflate_arity() {
        let body = "literal(X, Y) :- entity(X, _, 'a, b', _), foo(Y).";
        let h = detect_head(body).unwrap();
        assert_eq!(h.arity, 2);
    }

    #[test]
    fn rejects_empty_body() {
        let body = "% only comments\n";
        assert!(detect_head(body).is_err());
    }

    #[test]
    fn head_pattern_formats_args() {
        assert_eq!(head_pattern("near", 2), "near(_, _)");
        assert_eq!(head_pattern("alone", 0), "alone");
        assert_eq!(head_pattern("triple", 3), "triple(_, _, _)");
    }
}
