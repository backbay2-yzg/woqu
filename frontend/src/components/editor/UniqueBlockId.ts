import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'callout',
  'toggle',
  'codeBlock',
  'bulletList',
  'orderedList',
  'taskList',
  'table',
  'mathBlock',
  'bookmark',
  'fileBlock',
  'inlineDatabase',
  'columns',
  'image',
  'horizontalRule',
]);

function makeBlockID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

export const UniqueBlockId = Extension.create({
  name: 'uniqueBlockId',

  addGlobalAttributes() {
    return [
      {
        types: Array.from(BLOCK_TYPES),
        attributes: {
          blockId: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-block-id'),
            renderHTML: (attrs) => (attrs.blockId ? { 'data-block-id': attrs.blockId } : {}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('uniqueBlockId'),
        appendTransaction(_transactions, _oldState, newState) {
          const seen = new Set<string>();
          let tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (!BLOCK_TYPES.has(node.type.name)) {
              return true;
            }
            const id = node.attrs.blockId as string | null;
            if (!id || seen.has(id)) {
              const nextId = makeBlockID();
              seen.add(nextId);
              tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: nextId });
              modified = true;
            } else {
              seen.add(id);
            }
            return true;
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});
