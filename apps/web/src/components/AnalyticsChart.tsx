import { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { useReducedMotion } from 'motion/react';
import { Button } from '@orbit/ui';
type Series = { key: string; name: string; color: string };
export default function AnalyticsChart({
  title,
  description,
  data,
  xKey,
  series,
  kind = 'bar',
}: {
  title: string;
  description: string;
  data: Record<string, string | number | null>[];
  xKey: string;
  series: Series[];
  kind?: 'bar' | 'line';
}) {
  const [hidden, setHidden] = useState<string[]>([]),
    reduced = useReducedMotion();
  const tooltip = (
    <Tooltip
      contentStyle={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        color: 'var(--foreground)',
      }}
      labelStyle={{ color: 'var(--foreground)' }}
      itemStyle={{ color: 'var(--foreground)' }}
    />
  );
  const axes = (
    <>
      <CartesianGrid stroke="var(--border)" vertical={false} />
      <XAxis
        dataKey={xKey}
        tick={{ fill: 'var(--muted)', fontSize: 11 }}
        tickLine={false}
        axisLine={false}
        minTickGap={25}
      />
      <YAxis
        tick={{ fill: 'var(--muted)', fontSize: 11 }}
        tickLine={false}
        axisLine={false}
        allowDecimals={false}
        width={40}
      />
      {tooltip}
    </>
  );
  return (
    <section className="analytics-panel">
      <header>
        <span className="analytics-eyebrow">PROJECT SIGNALS</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      <div className="analytics-series" role="group" aria-label={`${title} series`}>
        {series.map((row) => (
          <Button
            key={row.key}
            size="small"
            variant="ghost"
            aria-pressed={!hidden.includes(row.key)}
            onClick={() =>
              setHidden((current) =>
                current.includes(row.key)
                  ? current.filter((value) => value !== row.key)
                  : [...current, row.key],
              )
            }
          >
            <span style={{ background: row.color }} aria-hidden="true" />
            {row.name}
          </Button>
        ))}
      </div>
      <div className="analytics-chart" role="group" aria-label={`${title} chart`}>
        <ResponsiveContainer
          width="100%"
          height={250}
          initialDimension={{ width: 600, height: 250 }}
        >
          {kind === 'bar' ? (
            <BarChart
              data={data}
              accessibilityLayer
              margin={{ top: 12, right: 10, bottom: 5, left: 0 }}
            >
              {axes}
              {series
                .filter((row) => !hidden.includes(row.key))
                .map((row) => (
                  <Bar
                    key={row.key}
                    dataKey={row.key}
                    name={row.name}
                    fill={row.color}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={!reduced}
                    animationDuration={200}
                  />
                ))}
            </BarChart>
          ) : (
            <LineChart
              data={data}
              accessibilityLayer
              margin={{ top: 12, right: 10, bottom: 5, left: 0 }}
            >
              {axes}
              {series
                .filter((row) => !hidden.includes(row.key))
                .map((row) => (
                  <Line
                    key={row.key}
                    type="stepAfter"
                    dataKey={row.key}
                    name={row.name}
                    stroke={row.color}
                    strokeWidth={2.5}
                    connectNulls={false}
                    dot={data.length <= 30 ? { r: 3 } : false}
                    isAnimationActive={!reduced}
                    animationDuration={200}
                  />
                ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <p className="analytics-keyboard">
        Focus the chart and use the arrow keys to inspect values. The same data is available below.
      </p>
      <details className="analytics-data">
        <summary>Show {title.toLowerCase()} data table</summary>
        <div
          className="analytics-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={`${title} data table`}
        >
          <table>
            <caption>{title} — all reported values</caption>
            <thead>
              <tr>
                <th scope="col">
                  {xKey === 'date' ? 'UTC date' : xKey === 'name' ? 'Sprint' : 'Category'}
                </th>
                {series.map((row) => (
                  <th scope="col" key={row.key}>
                    {row.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, index) => (
                <tr key={index}>
                  <th scope="row">{row[xKey]}</th>
                  {series.map((value) => (
                    <td key={value.key}>{row[value.key] ?? 'Unavailable'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
