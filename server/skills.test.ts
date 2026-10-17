import { describe, expect, it } from 'vitest'

import { parseSkill } from './pure'

describe('parseSkill', () => {
  it('reads plain and quoted fields', () => {
    const text = '---\nname: grill-me\ndescription: Interview the user about a plan.\nargument-hint: "<PR URL or number>"\n---\n\n# Body'

    expect(parseSkill(text)).toEqual({
      name: 'grill-me',
      description: 'Interview the user about a plan.',
      argumentHint: '<PR URL or number>',
    })
  })

  it('joins a description folded over indented lines', () => {
    const text = '---\nname: x\ndescription: >\n  First line\n  second line.\nother: y\n---\n'

    expect(parseSkill(text).description).toBe('First line second line.')
    expect(parseSkill('---\ndescription: Starts here\n  and goes on.\n---\n').description).toBe('Starts here and goes on.')
  })

  it('is empty without frontmatter', () => {
    expect(parseSkill('# Just a body')).toEqual({ name: '', description: '', argumentHint: '' })
  })
})
