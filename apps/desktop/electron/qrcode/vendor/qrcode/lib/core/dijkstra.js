// @ts-nocheck
function find_path (graph, start, end) {
  const distances = {}
  const previous = {}
  const visited = {}
  const nodes = Object.keys(graph)

  for (let index = 0; index < nodes.length; index++) {
    distances[nodes[index]] = Infinity
  }

  distances[start] = 0

  while (true) {
    let closestNode = null
    let closestDistance = Infinity

    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]
      if (!visited[node] && distances[node] < closestDistance) {
        closestNode = node
        closestDistance = distances[node]
      }
    }

    if (closestNode === null) break
    if (closestNode === end) break

    visited[closestNode] = true
    const neighbors = graph[closestNode] || {}
    const neighborNodes = Object.keys(neighbors)

    for (let index = 0; index < neighborNodes.length; index++) {
      const neighbor = neighborNodes[index]
      if (distances[neighbor] === undefined) {
        distances[neighbor] = Infinity
        nodes.push(neighbor)
      }
      const distance = distances[closestNode] + neighbors[neighbor]

      if (distance < distances[neighbor]) {
        distances[neighbor] = distance
        previous[neighbor] = closestNode
      }
    }
  }

  if (start !== end && previous[end] === undefined) {
    throw new Error('Could not find path from ' + start + ' to ' + end)
  }

  const path = []
  let current = end

  while (current !== undefined) {
    path.unshift(current)
    if (current === start) break
    current = previous[current]
  }

  return path
}

module.exports = { find_path }
