/*!
 * Copyright (c) 2021 Digital Bazaar, Inc. All rights reserved.
 */
import {CborldError} from './CborldError.js';
// FIXME: abstract away
import {VocabTermDecoder} from './codecs/VocabTermDecoder.js';

export class Transformer {
  /**
   * Creates a new Transformer for transforming CBOR-LD <=> JSON-LD.
   *
   * @param {object} options - The options to use when encoding to CBOR-LD.
   * @param {documentLoaderFunction} options.documentLoader -The document
   *   loader to use when resolving JSON-LD Context URLs.
   * @param {Map} [options.appContextMap] - A map of JSON-LD Context URLs and
   *   their encoded CBOR-LD values (must be values greater than 32767
   *   (0x7FFF)).
   */
  constructor({appContextMap, documentLoader} = {}) {
    // FIXME: rename `appContextMap`?
    this.appContextMap = appContextMap;
    this.documentLoader = documentLoader;
  }

  /**
   * Get the active context to use for the given object and optional
   * `encodedMap` (present when decoding).
   *
   * @param {object} options - The options to use.
   * @param {object} options.obj - The object to get the active context for.
   * @param {Map} [options.encodedMap] - The encoded map used during decoding.
   * @param {Array} [options.contextStack] - The stack of active contexts.
   * @param {boolean} [options.scoped=false] - Whether the context is scoped.
   *
   * @returns {Promise<object>} - The active context instance.
   */
  async _getActiveContext({obj, encodedMap, contextStack, scoped = false}) {
    const stackTop = contextStack.length;

    // push any local embedded contexts onto the context stack
    const localContexts = obj['@context'];
    await this._updateContextStack(
      {contextStack, contexts: localContexts, scoped});

    // get `id` and `type` aliases for the active context
    let active = contextStack[contextStack.length - 1];
    if(!active) {
      // empty initial context
      active = {
        aliases: {
          id: new Set(),
          type: new Set()
        },
        context: {},
        scopedContextMap: new Map(),
        termMap: new Map()
      };
    }
    const {aliases} = active;

    // TODO: support `@propagate: true` on type-scoped contexts

    // save context stack prior to processing types
    const childContextStack = contextStack.slice();

    // get unique object type(s)
    let totalTypes = [];
    const typeTerms = ['@type', ...aliases.type];
    const {termToId} = this;
    for(const term of typeTerms) {
      // if an `encodedMap` was provided, decode types into `obj` first
      if(encodedMap) {
        const encodedTypes = encodedMap.get(termToId.get(term));
        if(encodedTypes === undefined) {
          continue;
        }
        // FIXME: abstract this out to allow transformer subclass to call
        // a function to handle it
        const decoder = new VocabTermDecoder();
        if(Array.isArray(encodedTypes)) {
          obj[term] = encodedTypes.map(
            encoded => decoder.decode({encoded, termToId}));
        } else {
          obj[term] = decoder.decode({encoded: encodedTypes, termToId});
        }
      }
      const types = obj[term];
      if(Array.isArray(types)) {
        totalTypes.push(...types);
      } else {
        totalTypes.push(types);
      }
    }
    totalTypes = [...new Set(totalTypes)].sort();

    // FIXME: note -- decoder should know when to pull in scoped contexts
    // without having to call them out in the encoding, so don't include them
    // in the encoding

    // apply any type-scoped contexts
    let {scopedContextMap} = active;
    for(const type of totalTypes) {
      const contexts = scopedContextMap.get(type);
      if(contexts) {
        await this._updateContextStack({contextStack, contexts, scoped: true});
        active = contextStack[contextStack.length - 1];
        ({scopedContextMap} = active);
      }
    }

    return {
      ...active,
      childContextStack,
      revert() {
        contextStack.length = stackTop;
      }
    };
  }

  async _updateContextStack({
    contextStack, contexts, transformer, scoped = false
  }) {
    // push any localized contexts onto the context stack
    if(!contexts) {
      return;
    }
    if(!Array.isArray(contexts)) {
      contexts = [contexts];
    }

    const {contextMap} = this;
    for(const context of contexts) {
      let entry = contextMap.get(context);
      if(!entry) {
        let ctx = context;
        let contextUrl;
        if(typeof context === 'string') {
          // fetch context
          contextUrl = context;
          ({'@context': ctx} = await this._getDocument({url: contextUrl}));
        } else if(!scoped) {
          // FIXME: do we need to throw this error anymore?
          // FIXME: use CborldError
          throw new CborldError(
            'ERR_EMBEDDED_JSONLD_CONTEXT_DETECTED',
            'CBOR-LD does not support embedded JSON-LD contexts; one was ' +
            `detected in "${JSON.stringify(contexts)}".`);
        }
        // FIXME: validate `ctx` to ensure its a valid JSON-LD context value
        // add context
        entry = await this._addContext({context: ctx, contextUrl, transformer});
      }

      // clone entry to create new active context entry for context stack
      const newActive = {
        aliases: {
          id: new Set(entry.aliases.id),
          type: new Set(entry.aliases.type)
        },
        context,
        scopedContextMap: new Map(entry.scopedContextMap),
        termMap: new Map(entry.termMap)
      };

      // push new active context and get old one
      contextStack.push(newActive);
      const oldActive = contextStack[contextStack.length];
      if(!oldActive) {
        continue;
      }

      // compute `id` and `type` aliases by including any previous aliases that
      // have not been replaced by the new context
      const {aliases, termMap} = newActive;
      for(const key of ['id', 'type']) {
        for(const alias of oldActive.aliases[key]) {
          if(!(context[alias] === null || newActive.termMap.has(alias))) {
            aliases[key].add(alias);
          }
        }
      }

      // FIXME: is this sufficient? add tests with nested scope contexts

      // compute scoped context map by including any scoped contexts that have
      // not been replaced by the new context
      const {scopedContextMap} = newActive;
      for(const [key, value] of oldActive.scopedContextMap) {
        if(!(context[key] === null || scopedContextMap.has(key))) {
          scopedContextMap.set(key, value);
        }
      }

      // compute new terms map
      for(const [key, value] of oldActive.termMap) {
        if(!(context[key] === null || termMap.has(key))) {
          termMap.set(key, value);
        }
      }
    }
  }

  async _addContext({context, contextUrl}) {
    const {contextMap, termToId, idToTerm} = this;

    // handle `@import`
    const importUrl = context['@import'];
    if(importUrl) {
      let importEntry = contextMap.get(importUrl);
      if(!importEntry) {
        const {'@context': importCtx} = await this._getDocument(
          {url: importUrl});
        importEntry = await this._addContext(
          {context: importCtx, contextUrl: importUrl});
      }
      context = {...importEntry.context, ...context};
    }

    // precompute any `@id` and `@type` aliases, scoped contexts, and terms
    const scopedContextMap = new Map();
    const termMap = new Map();
    const entry = {
      aliases: {id: new Set(), type: new Set()},
      context,
      scopedContextMap,
      termMap
    };

    for(const key in context) {
      const def = context[key];
      if(!def) {
        continue;
      }
      // ensure the term has been assigned an ID
      if(!termToId.has(key)) {
        const id = termToId.size * 2;
        termToId.set(key, id);
        idToTerm.set(id, key);
      }
      // FIXME: determine if we need `aliases` for `id`; we may only need
      // it for `type`
      if(def === '@id' || def.id === '@id') {
        entry.aliases.id.add(key);
      } else if(def === '@type' || def.id === '@type') {
        // FIXME: need to make sure this doesn't conflict with a different
        // term definition later... e.g., if a type alias exists and then
        // another term definition that is not an alias overrides it, we
        // need to make sure we clear the alias
        entry.aliases.type.add(key);
      }
      if(!key.startsWith('@')) {
        termMap.set(key, def);
        const scopedContext = def['@context'];
        if(scopedContext) {
          scopedContextMap.set(key, scopedContext);
        }
      }
    }

    // add entry for context URL or context object
    contextMap.set(contextUrl || context, entry);

    return entry;
  }

  async _getDocument({url}) {
    const {document} = await this.documentLoader(url);
    if(typeof document === 'string') {
      return JSON.parse(document);
    }
    return document;
  }

  _getTermType({activeCtx, def}) {
    const {'@type': type} = def;
    if(!type) {
      // no term type
      return;
    }

    // check for potential CURIE value
    const [prefix, ...suffix] = type.split(':');
    const prefixDef = activeCtx.termMap.get(prefix);
    if(prefixDef === undefined) {
      // no CURIE
      return type;
    }

    // handle CURIE
    if(typeof prefixDef === 'string') {
      return prefixDef + suffix.join(':');
    }

    // prefix definition must be an object
    if(!(typeof prefixDef === 'object' &&
      typeof prefixDef['@id'] === 'string')) {
      // FIXME: use CborldError
      throw new Error('Invalid term definition');
    }
    return prefixDef['@id'] + suffix.join(':');
  }

  _getIdForTerm({term, plural}) {
    const id = this.termToId.get(term);
    if(id === undefined) {
      // FIXME: use CBOR-LD error
      throw new Error('term not defined');
    }
    return plural ? id + 1 : id;
  }

  _getTermForId({id}) {
    const plural = (id & 1) === 1;
    const term = this.idToTerm.get(plural ? id - 1 : id);
    return {term, plural};
  }
}

/**
 * Fetches a resource given a URL and returns it as a string.
 *
 * @callback documentLoaderFunction
 * @param {string} url - The URL to retrieve.
 *
 * @returns {string} The resource associated with the URL as a string.
 */