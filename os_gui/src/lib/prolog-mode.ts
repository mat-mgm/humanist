// Minimal Prolog StreamLanguage for CodeMirror 6.
// Covers comments, strings, atoms, variables, numbers, and a small list of
// builtins / control operators. Good enough for the Rules panel, where
// rules are short and we mainly want comments and quoted atoms to stand out.

import { StreamLanguage, StreamParser } from '@codemirror/language';

const BUILTINS = new Set([
  'assertz', 'asserta', 'retract', 'retractall', 'consult',
  'is', 'true', 'false', 'fail', 'not', 'write', 'writeln', 'nl',
  'findall', 'bagof', 'setof', 'forall', 'aggregate_all',
  'length', 'member', 'append', 'reverse', 'sort', 'msort',
  'atom', 'atom_chars', 'atom_codes', 'atom_concat', 'atom_length',
  'number', 'number_chars', 'number_codes',
  'functor', 'arg', 'copy_term', 'ground',
  'use_module', 'module', 'dynamic', 'discontiguous',
]);

const parser: StreamParser<Record<string, never>> = {
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null;

    // Line comment
    if (stream.match('%')) {
      stream.skipToEnd();
      return 'comment';
    }
    // Block comment /* ... */
    if (stream.match('/*')) {
      while (!stream.eol()) {
        if (stream.match('*/')) return 'comment';
        stream.next();
      }
      return 'comment';
    }
    // Quoted atom
    if (stream.match("'")) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') { stream.next(); continue; }
        if (ch === "'") return 'string';
      }
      return 'string';
    }
    // Double-quoted string (often a list of char codes in Prolog, but
    // syntactically a string here).
    if (stream.match('"')) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') { stream.next(); continue; }
        if (ch === '"') return 'string';
      }
      return 'string';
    }
    // Number
    if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) {
      return 'number';
    }
    // Variable: starts with uppercase or _
    if (stream.match(/^[A-Z_][A-Za-z0-9_]*/)) {
      return 'variableName';
    }
    // Atom / functor
    if (stream.match(/^[a-z][A-Za-z0-9_]*/)) {
      const word = stream.current();
      if (BUILTINS.has(word)) return 'keyword';
      return 'atom';
    }
    // Operators / punctuation
    if (stream.match(':-') || stream.match('->') || stream.match('-->')) {
      return 'operator';
    }
    if (stream.match(/^[+\-*/=<>!@#$^&|~?]+/)) {
      return 'operator';
    }
    // Anything else: punctuation char-by-char
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '%' },
  },
};

export const prolog = () => StreamLanguage.define(parser);
