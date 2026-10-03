# Word data — sources and licences

Built by `scripts/build-words.mjs` (spec 004 tech §2). Rebuild instead of editing these files by hand.

| File | Built from | Licence |
|---|---|---|
| `words.json` | ENABLE word list ∩ WordNet 3.1 lemmas, ranked by WordNet tag counts | ENABLE: public domain; WordNet: WordNet licence (below) |
| `related-words.json` | WordNet 3.1 synonyms, hypernyms and similar adjectives of each word's most common sense | WordNet licence |
| `trigrams.json` | character trigram counts over `words.json` | derived data |
| `profanity.json` | LDNOOBW "List of Dirty, Naughty, Obscene and Otherwise Bad Words" (English) | CC BY 4.0 — © Shutterstock and contributors, https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words |

WordNet was obtained through the npm package `wordnet-db` 3.1.14 (MIT packaging of the WordNet 3.1 files).

## WordNet licence

WordNet Release 3.0 (and 3.1). This software and database is being provided to you, the LICENSEE, by Princeton
University under the following license. By obtaining, using and/or copying this software and database, you agree
that you have read, understood, and will comply with these terms and conditions.

Permission to use, copy, modify and distribute this software and database and its documentation for any purpose
and without fee or royalty is hereby granted, provided that you agree to comply with the following copyright notice
and statements, including the disclaimer, and that the same appear on ALL copies of the software, database and
documentation, including modifications that you make for internal use or for distribution.

WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.

THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES,
EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR
WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE LICENSED SOFTWARE,
DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.

The name of Princeton University or Princeton may not be used in advertising or publicity pertaining to
distribution of the software and/or database. Title to copyright in this software, database and any associated
documentation shall at all times remain with Princeton University and LICENSEE agrees to preserve same.
