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

  // Solarized Light colors
  const solBase3 = '#fdf6e3'  // lightest bg
  const solBase2 = '#eee8d5'  // secondary bg
  const solBase1 = '#93a1a1'  // subtle
  const solBase00 = '#657b83' // body text
  const solBase01 = '#586e75' // emphasis
  const solBlue = '#268bd2'
  const solCyan = '#2aa198'

  return (
    <Plot
      data={[
        {
          x: timestamps,
          y: marketCaps,
          type: 'scatter',
          mode: 'lines',
          line: { color: solBlue, width: 2.5 },
          fill: 'tozeroy',
          fillcolor: 'rgba(38, 139, 210, 0.1)',
          hovertemplate: '%{x|%b %d, %Y}<br>$%{y:.2f}B<extra></extra>',
        },
      ]}
      layout={{
        title: {
          text: title,
          font: { size: 16, color: solBase01 },
        },
        xaxis: {
          title: { text: 'Date', font: { color: solBase00 } },
          tickformat: '%b %Y',
          tickfont: { color: solBase00 },
          gridcolor: `${solBase1}40`,
          linecolor: solBase1,
          range: paddedEndDate ? [timestamps[0], paddedEndDate] : undefined,
        },
        yaxis: {
          title: { text: 'Market Cap (Billions USD)', font: { color: solBase00 } },
          tickprefix: '$',
          ticksuffix: 'B',
          tickfont: { color: solBase00 },
          gridcolor: `${solBase1}40`,
          linecolor: solBase1,
        },
        margin: { t: 50, r: 30, b: 50, l: 70 },
        hovermode: 'x',
        hoverlabel: {
          bgcolor: solBase2,
          bordercolor: solBlue,
          font: { color: solBase01 },
        },
        plot_bgcolor: solBase3,
        paper_bgcolor: solBase3,
      }}
      style={{ width: '100%', height: '400px' }}
      config={{ responsive: true }}
    />
  )
}
