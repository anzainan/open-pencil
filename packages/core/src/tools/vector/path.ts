import { cloneVectorNetwork } from '@open-pencil/scene-graph'
import type { SceneNode, VectorNetwork } from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import { defineTool } from '#core/tools/schema'

function getVectorNode(figma: FigmaAPI, id: string): { node: SceneNode; vn: VectorNetwork } {
  const node = figma.graph.getNode(id)
  if (!node) throw new Error(`Node "${id}" not found`)
  if (!node.vectorNetwork) throw new Error(`Node "${id}" has no vector data`)
  return { node, vn: cloneVectorNetwork(node.vectorNetwork) }
}

export const pathGet = defineTool({
  name: 'path_get',
  description: 'Get vector path data of a node.',
  params: {
    id: { type: 'string', description: 'Node ID', required: true }
  },
  execute: (figma, { id }) => {
    const raw = figma.graph.getNode(id)
    if (!raw) throw new Error(`Node "${id}" not found`)
    const vectorNetwork = raw.vectorNetwork
    if (!vectorNetwork) throw new Error(`Node "${id}" has no vector data`)
    return { id, vectorNetwork }
  }
})

export const pathSet = defineTool({
  name: 'path_set',
  mutates: true,
  description: 'Set vector path data on a node. Provide a VectorNetwork JSON.',
  params: {
    id: { type: 'string', description: 'Node ID', required: true },
    path: { type: 'string', description: 'VectorNetwork JSON', required: true }
  },
  execute: (figma, args) => {
    const raw = figma.graph.getNode(args.id)
    if (!raw) throw new Error(`Node "${args.id}" not found`)
    const network = JSON.parse(args.path)
    figma.graph.updateNode(args.id, { vectorNetwork: network })
    return { id: args.id }
  }
})

export const pathScale = defineTool({
  name: 'path_scale',
  mutates: true,
  description: 'Scale vector path from center.',
  params: {
    id: { type: 'string', description: 'Node ID', required: true },
    factor: { type: 'number', description: 'Scale factor (e.g. 2 for double)', required: true }
  },
  execute: (figma, { id, factor }) => {
    const { node: raw, vn } = getVectorNode(figma, id)
    const centerX = raw.width / 2
    const centerY = raw.height / 2
    for (const vertex of vn.vertices) {
      vertex.x = centerX + (vertex.x - centerX) * factor
      vertex.y = centerY + (vertex.y - centerY) * factor
    }
    for (const segment of vn.segments) {
      segment.tangentStart.x *= factor
      segment.tangentStart.y *= factor
      segment.tangentEnd.x *= factor
      segment.tangentEnd.y *= factor
    }

    figma.graph.updateNode(id, { vectorNetwork: vn })
    return { id, factor }
  }
})

export const pathFlip = defineTool({
  name: 'path_flip',
  mutates: true,
  description: 'Flip vector path horizontally or vertically.',
  params: {
    id: { type: 'string', description: 'Node ID', required: true },
    axis: {
      type: 'string',
      description: 'Flip axis',
      required: true,
      enum: ['horizontal', 'vertical']
    }
  },
  execute: (figma, { id, axis }) => {
    const { node: raw, vn } = getVectorNode(figma, id)
    const width = raw.width
    const height = raw.height
    for (const vertex of vn.vertices) {
      if (axis === 'horizontal') vertex.x = width - vertex.x
      else vertex.y = height - vertex.y
    }
    for (const segment of vn.segments) {
      if (axis === 'horizontal') segment.tangentStart.x = -segment.tangentStart.x
      else segment.tangentStart.y = -segment.tangentStart.y
      if (axis === 'horizontal') segment.tangentEnd.x = -segment.tangentEnd.x
      else segment.tangentEnd.y = -segment.tangentEnd.y
    }

    figma.graph.updateNode(id, { vectorNetwork: vn })
    return { id, axis }
  }
})

export const pathMove = defineTool({
  name: 'path_move',
  mutates: true,
  description: 'Move all path points by an offset.',
  params: {
    id: { type: 'string', description: 'Node ID', required: true },
    dx: { type: 'number', description: 'X offset', required: true },
    dy: { type: 'number', description: 'Y offset', required: true }
  },
  execute: (figma, { id, dx, dy }) => {
    const { vn } = getVectorNode(figma, id)
    for (const vertex of vn.vertices) {
      vertex.x += dx
      vertex.y += dy
    }

    figma.graph.updateNode(id, { vectorNetwork: vn })
    return { id, dx, dy }
  }
})
