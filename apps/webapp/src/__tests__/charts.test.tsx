import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BarChart } from '../components/charts/bar-chart'
import { DonutChart } from '../components/charts/donut-chart'

describe('BarChart', () => {
  it('renders only positive values, skipping a net-negative entry rather than showing a misleading small bar', () => {
    render(
      <BarChart
        data={[
          { label: 'Carrefour', value: 100 },
          { label: 'Refund Store', value: -20 },
        ]}
      />,
    )

    expect(screen.getByText('Carrefour')).toBeInTheDocument()
    expect(screen.queryByText('Refund Store')).not.toBeInTheDocument()
  })

  it('shows the empty state when every value is non-positive', () => {
    render(
      <BarChart
        data={[
          { label: 'A', value: -10 },
          { label: 'B', value: 0 },
        ]}
      />,
    )
    expect(screen.getByText('Nothing to show yet.')).toBeInTheDocument()
  })
})

describe('DonutChart', () => {
  it('renders only positive slices, skipping a net-negative entry', () => {
    render(
      <DonutChart
        data={[
          { label: 'Groceries', value: 100 },
          { label: 'Refunds', value: -30 },
        ]}
      />,
    )

    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.queryByText('Refunds')).not.toBeInTheDocument()
  })

  it('computes percentages against only the positive slices, not a total including negatives', () => {
    render(
      <DonutChart
        data={[
          { label: 'A', value: 50 },
          { label: 'B', value: 50 },
          { label: 'C', value: -1000 },
        ]}
      />,
    )
    // If the negative slice were included in the total, A/B would each show
    // far less than 50%.
    expect(screen.getAllByText(/50%/)).toHaveLength(2)
  })

  it('shows the empty state when every value is non-positive', () => {
    render(<DonutChart data={[{ label: 'A', value: -10 }]} />)
    expect(screen.getByText('Nothing to show yet.')).toBeInTheDocument()
  })
})
