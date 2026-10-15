import { describe, expect, it } from 'vitest'

import { batteryOf } from './system'

const supply = (type: string, capacity = '', status = '', online = '') => ({ type, capacity, status, online })

describe('batteryOf', () => {
  it('is null without a battery', () => {
    expect(batteryOf([supply('Mains', '', '', '1')])).toBeNull()
  })

  it('reads a charging battery on mains power', () => {
    expect(batteryOf([supply('Mains', '', '', '1'), supply('Battery', '29', 'Charging')])).toEqual({
      percent: 29,
      isCharging: true,
      isPluggedIn: true,
    })
  })

  it('averages two batteries and sees when it runs on battery', () => {
    expect(batteryOf([supply('Mains', '', '', '0'), supply('Battery', '80', 'Discharging'), supply('Battery', '41', 'Discharging')])).toEqual({
      percent: 61,
      isCharging: false,
      isPluggedIn: false,
    })
  })
})
