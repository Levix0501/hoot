import { describe, expect, it } from 'vitest'
import { draggedPanelEdge, draggedTreeEdge } from './file-panel'

// In a session's page 1000 pixels wide, the terminal keeps 360 of them, which
// leaves the panel 640: with a tree 250 wide and the panel's two lines, the
// open files get up to 388.

describe('draggedPanelEdge', () => {
  const start = { treeWidth: 250, editorWidth: 300 }

  it('moves the edge as far as the pointer moves, resizing the open files', () => {
    expect(draggedPanelEdge(start, true, 500, 450, 1000)).toEqual({
      treeWidth: 250,
      editorWidth: 350,
    })
    expect(draggedPanelEdge(start, true, 500, 520.4, 1000)).toEqual({
      treeWidth: 250,
      editorWidth: 280,
    })
  })

  it('resizes the tree while no file is open', () => {
    expect(draggedPanelEdge(start, false, 500, 450, 1000)).toEqual({
      treeWidth: 300,
      editorWidth: 300,
    })
  })

  it("stops at the limits of the open files' width", () => {
    expect(draggedPanelEdge(start, true, 500, 600, 1000).editorWidth).toBe(240)
    expect(draggedPanelEdge(start, true, 500, -3000, 4000).editorWidth).toBe(1600)
  })

  it("stops at the limits of the tree's width", () => {
    expect(draggedPanelEdge(start, false, 500, 600, 1000).treeWidth).toBe(200)
    expect(draggedPanelEdge(start, false, 500, 0, 1000).treeWidth).toBe(480)
  })

  it('leaves the terminal 360 pixels of the page, or half of a narrow one', () => {
    expect(draggedPanelEdge(start, true, 500, 300, 1000).editorWidth).toBe(388)
    expect(draggedPanelEdge(start, true, 500, 0, 1000).editorWidth).toBe(388)
    // 600 pixels: the terminal keeps 300, and the tree gets up to 299 beside the panel's line.
    expect(draggedPanelEdge(start, false, 500, 0, 600).treeWidth).toBe(299)
  })

  it('never makes a part narrower than its narrowest width, even in a page too narrow for it', () => {
    expect(draggedPanelEdge(start, true, 500, 450, 700).editorWidth).toBe(240)
  })
})

describe('draggedTreeEdge', () => {
  it('widens the tree into the open files, keeping the panel as wide', () => {
    expect(draggedTreeEdge({ treeWidth: 250, editorWidth: 300 }, 500, 460, 1000)).toEqual({
      treeWidth: 290,
      editorWidth: 260,
    })
  })

  it('narrows the tree, giving the open files what it loses', () => {
    expect(draggedTreeEdge({ treeWidth: 250, editorWidth: 300 }, 500, 530, 1000)).toEqual({
      treeWidth: 220,
      editorWidth: 330,
    })
    expect(draggedTreeEdge({ treeWidth: 250, editorWidth: 300 }, 500, 600, 1000)).toEqual({
      treeWidth: 200,
      editorWidth: 350,
    })
  })

  it('widens the panel once the open files are at their narrowest, as far as the terminal allows', () => {
    expect(draggedTreeEdge({ treeWidth: 250, editorWidth: 300 }, 500, 400, 1000)).toEqual({
      treeWidth: 350,
      editorWidth: 240,
    })
    // The panel then fills the 640 pixels it has.
    expect(draggedTreeEdge({ treeWidth: 250, editorWidth: 300 }, 500, 200, 1000)).toEqual({
      treeWidth: 398,
      editorWidth: 240,
    })
  })

  it("stops at the limit of the tree's width", () => {
    expect(draggedTreeEdge({ treeWidth: 250, editorWidth: 480 }, 500, 0, 4000)).toEqual({
      treeWidth: 480,
      editorWidth: 250,
    })
  })

  it('does not widen the tree in a page too narrow for the panel, but narrows it', () => {
    // 800 pixels leave the panel 440, of which the open files show 188.
    expect(draggedTreeEdge({ treeWidth: 250, editorWidth: 188 }, 500, 450, 800).treeWidth).toBe(250)
    expect(draggedTreeEdge({ treeWidth: 250, editorWidth: 188 }, 500, 530, 800).treeWidth).toBe(220)
  })
})
