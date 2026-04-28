import Plotly from 'react-plotly.js'

// Handle ESM/CJS default export differences
const Plot = (Plotly as any).default || Plotly

interface DataPoint {
  timestamp: string
  market_cap: number
}

interface MarketCapChartProps {
  data: DataPoint[]
  title: string
}

export function MarketCapChart({ data, title }: MarketCapChartProps) {
  const timestamps = data.map((d) => d.timestamp)
  const marketCaps = data.map((d) => d.market_cap / 1e9) // Convert to billions

  // Add padding to show the last data point clearly
  const lastDate = timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]) : null
  const paddedEndDate = lastDate ? new Date(lastDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString() : undefined

  return (
    <Plot
      data={[
        {
          x: timestamps,
          y: marketCaps,
          type: 'scatter',
          mode: 'lines',
          line: { color: '#3b82f6', width: 2 },
          hovertemplate: '%{x|%b %d, %Y}<br>$%{y:.2f}B<extra></extra>',
        },
      ]}
      layout={{
        title: {
          text: title,
          font: { size: 16 },
        },
        xaxis: {
          title: 'Date',
          tickformat: '%b %Y',
          range: paddedEndDate ? [timestamps[0], paddedEndDate] : undefined,
        },
        yaxis: {
          title: 'Market Cap (Billions USD)',
          tickprefix: '$',
          ticksuffix: 'B',
        },
        margin: { t: 50, r: 30, b: 50, l: 70 },
        hovermode: 'x',
        plot_bgcolor: '#fafafa',
        paper_bgcolor: 'white',
      }}
      style={{ width: '100%', height: '400px' }}
      config={{ responsive: true }}
    />
  )
}
