import {
  defineTool,
  importedFlexMutationWarnings,
  nodeNotFound,
  nodeSummary,
  withWarnings
} from '#core/tools/schema'

export const deleteNode = defineTool({
  name: 'delete_node',
  mutates: true,
  description: 'Delete a node by ID.',
  params: {
    id: { type: 'string', description: 'Node ID to delete', required: true }
  },
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    if (!node) throw new Error(`Node "${id}" not found`)
    node.remove()
    return { deleted: id }
  }
})

export const cloneNode = defineTool({
  name: 'clone_node',
  mutates: true,
  description: 'Clone (duplicate) a node.',
  params: {
    id: { type: 'string', description: 'Node ID to clone', required: true }
  },
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    if (!node) throw new Error(`Node "${id}" not found`)
    const clone = node.clone()
    return nodeSummary(clone)
  }
})

export const renameNode = defineTool({
  name: 'rename_node',
  mutates: true,
  description: 'Rename a node in the layers panel.',
  params: {
    id: { type: 'string', description: 'Node ID', required: true },
    name: { type: 'string', description: 'New name', required: true }
  },
  execute: (figma, { id, name }) => {
    const node = figma.getNodeById(id)
    if (!node) throw new Error(`Node "${id}" not found`)
    node.name = name
    return { id, name }
  }
})

export const nodeBounds = defineTool({
  name: 'node_bounds',
  description: 'Get absolute bounding box of a node.',
  params: {
    id: { type: 'string', description: 'Node ID', required: true }
  },
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    if (!node) throw new Error(`Node "${id}" not found`)
    return { id, bounds: node.absoluteBoundingBox }
  }
})

export const nodeMove = defineTool({
  name: 'node_move',
  mutates: true,
  description: 'Move a node to new coordinates.',
  params: {
    id: { type: 'string', description: 'Node ID', required: true },
    x: { type: 'number', description: 'X position', required: true },
    y: { type: 'number', description: 'Y position', required: true }
  },
  execute: (figma, { id, x, y }) => {
    const node = figma.getNodeById(id)
    if (!node) return nodeNotFound(id)
    node.x = x
    node.y = y
    const warnings = importedFlexMutationWarnings(figma, id, 'coordinates')
    return withWarnings({ id, x, y }, warnings)
  }
})

export const nodeResize = defineTool({
  name: 'node_resize',
  mutates: true,
  description: 'Resize a node.',
  params: {
    id: { type: 'string', description: 'Node ID', required: true },
    width: { type: 'number', description: 'Width', required: true, min: 1 },
    height: { type: 'number', description: 'Height', required: true, min: 1 }
  },
  execute: (figma, { id, width, height }) => {
    const node = figma.getNodeById(id)
    if (!node) return nodeNotFound(id)
    node.resize(width, height)
    // First line of defense: read back after write. The authoritative check
    // runs in the app wrapper after computeAllLayouts (appendPostComputeWarnings),
    // because Yoga may overwrite a flex HUG axis back to its computed size.
    if (
      Math.abs(node.width - width) > 0.001 ||
      Math.abs(node.height - height) > 0.001
    ) {
      return {
        id,
        width,
        height,
        warnings: [
          `尺寸被布局引擎覆盖（flex HUG），实际 width=${node.width} height=${node.height}`
        ]
      }
    }
    return { id, width, height }
  }
})
