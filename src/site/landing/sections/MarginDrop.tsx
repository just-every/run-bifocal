import { Question, Screen, Sentence } from '../parts'
import { records } from '../records'

/** 03: Granite Supply's September margin, explained in one four-bar waterfall drawn to scale above a broken 37% axis on
 * the cobalt half; the question and sentence on the yellow half, at the hero's 50/50 seam. */
export function MarginDrop() {
  return <Screen id="margin" className="s-margin split-screen fields">
    <div className="screen-copy">
      <Question id="margin-title" lines={['Why did', 'September', 'margin drop?']} />
      <Sentence>Freight cost 1.8 points and discounts 0.5, each traced to the certified definition and its rows.</Sentence>
    </div>
    <figure className="proof">
      <Waterfall orientation="vertical" />
      <Waterfall orientation="horizontal" />
      <figcaption className="vh">Gross margin fell from 41.2% in August to 38.9% in September: freight took 1.8 points and discounts 0.5.</figcaption>
    </figure>
  </Screen>
}

const fmt = (value: number) => value.toFixed(1)

/** The waterfall: bars, connectors and the broken axis as SVG, every bar to scale (one point of margin is `unit` design
 * pixels above the 37% break); the labels are text laid over it. Wide screens draw it upright with each label under
 * its bar; phones turn it on its side with each label over its bar's left end. */
function Waterfall({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  const { aug, freight, discounts, sep, axisFrom } = records.margin
  const steps = [
    { name: 'Aug', value: `${fmt(aug)}%`, from: axisFrom, to: aug },
    { name: 'Freight', value: `\u2212${fmt(freight)}`, from: aug - freight, to: aug },
    { name: 'Discounts', value: `\u2212${fmt(discounts)}`, from: sep, to: aug - freight },
    { name: 'Sep', value: `${fmt(sep)}%`, from: axisFrom, to: sep },
  ]
  const pct = (value: number, of: number) => `${(value / of * 100).toFixed(3)}%`
  if (orientation === 'vertical') {
    // 1440 design units: the axis runs 550 wide; bars 66 wide on 134 centres; 64.29 a point (the desk's 68.57 at 1536).
    const unit = 64.29, base = 300, top = base - (aug - axisFrom) * unit - 2, width = 560
    const y = (value: number) => base - (value - axisFrom) * unit
    const centres = [74, 208, 342, 476]
    return <div className="waterfall waterfall-v">
      <svg viewBox={`0 ${top} ${width} ${base + 2 - top}`} aria-hidden="true" focusable="false">
        <g className="wf-lines">
          <path className="wf-axis" d={`M0 ${base}H${width - 10}`} />
          <path className="wf-break" d={`M2 ${base + 9}l9-18M10 ${base + 9}l9-18`} />
          {steps.map((step, i) => <rect key={step.name} x={centres[i] - 33} y={y(step.to)} width={66} height={y(step.from) - y(step.to)} />)}
          {steps.slice(0, 3).map((step, i) => { const level = i === 0 ? step.to : step.from; return <path key={i} className="wf-link" d={`M${centres[i] + 33} ${y(level)}H${centres[i + 1] - 33}`} /> })}
        </g>
      </svg>
      <ul className="wf-labels">{steps.map((step, i) => <li key={step.name} style={{ left: pct(centres[i], width) }}><span>{step.name}</span> <span className="nw">{step.value}</span></li>)}</ul>
    </div>
  }
  // Phone: the axis is the left edge, bars run right; 77.9 a point, as the desk's phone plan draws it (204.5 at 2.626x).
  const unit = 77.9, left = 4, rowH = 92, barH = 26
  const x = (value: number) => left + (value - axisFrom) * unit
  const width = x(aug) + 6, height = steps.length * rowH + 10
  return <div className="waterfall waterfall-h">
    <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <g className="wf-lines">
        <path className="wf-axis" d={`M${left} 8V${height - 6}`} />
        <path className="wf-break" d={`M${left - 4} ${height - 2}l8-10M${left - 4} ${height + 5}l8-10`} />
        {steps.map((step, i) => <rect key={step.name} x={x(step.from)} y={i * rowH + 44} width={x(step.to) - x(step.from)} height={barH} />)}
        {steps.slice(0, 3).map((step, i) => { const level = i === 0 ? step.to : step.from; return <path key={i} className="wf-link" d={`M${x(level)} ${i * rowH + 44 + barH}V${(i + 1) * rowH + 44}`} /> })}
      </g>
    </svg>
    <ul className="wf-labels">{steps.map((step, i) => <li key={step.name} style={{ left: pct(x(step.from) + (i === 0 || i === 3 ? 4 : 0), width), top: pct(i * rowH + 16, height) }}><span className="nw">{step.name} {step.value}</span></li>)}</ul>
  </div>
}
