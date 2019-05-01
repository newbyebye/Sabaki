const {remote} = require('electron')
const {h, Component} = require('preact')
const helper = require('../modules/helper')
const t = require('../i18n').context('WinrateGraph')
const setting = remote.require('./setting')

let winrateGraphMinHeight = setting.get('view.winrategraph_minheight')

class WinrateGraph extends Component {
    constructor() {
        super()

        this.state = {
            height: setting.get('view.winrategraph_height'),
            invert: setting.get('view.winrategraph_invert')
        }

        setting.events.on('change', ({key, value}) => {
            if (key === 'view.winrategraph_invert') {
                this.setState({invert: value})
            }
        })

        this.handleMouseDown = evt => {
            this.mouseDown = true
            document.dispatchEvent(new MouseEvent('mousemove', evt))
        }

        this.handleHorizontalResizerWinrateMouseDown = ({button}) => {
            if (button !== 0) return
            this.horizontalResizerWinrateMouseDown = true
        }
    }

    shouldComponentUpdate({width, currentIndex, data}, {height, invert}) {
        return width !== this.props.width
            || currentIndex !== this.props.currentIndex
            || data[currentIndex] !== this.props.data[currentIndex]
            || height !== this.state.height
            || invert !== this.state.invert
    }

    componentDidMount() {
        document.addEventListener('mousemove', evt => {
            if (!this.mouseDown) return

            if (this.horizontalResizerWinrateMouseDown) {
                evt.preventDefault()

                let height = Math.min(
                    60, Math.max(winrateGraphMinHeight, evt.clientY)
                )
                this.setState({height})
                return
            }

            let rect = this.element.getBoundingClientRect()
            let percent = (evt.clientX - rect.left) / rect.width
            let {width, data, onCurrentIndexChange = helper.noop} = this.props
            let index = Math.max(Math.min(Math.round(width * percent), data.length - 1), 0)

            if (index !== this.props.currentIndex) onCurrentIndexChange({index})
        })

        document.addEventListener('mouseup', () => {
            if (this.horizontalResizerWinrateMouseDown) {
                this.horizontalResizerWinrateMouseDown = false
                setting.set('view.winrategraph_height', this.state.height)
                window.dispatchEvent(new Event('resize'))
            }
            this.mouseDown = false
        })

    }

    render({width, currentIndex, data}) {
        let scale = width / data.length
        let dataDiff = data.map((x, i) => i === 0 || x == null || data[i - 1] == null ? null : x - data[i - 1])
        let dataDiffMax = Math.max(...dataDiff.map(Math.abs), 25)

        return h('section',

            {
                ref: el => this.element = el,
                id: 'winrategraph',
                /*
                style: {
                    height: this.state.height + 'px'
                },
                */
                onMouseDown: this.handleMouseDown
            },

            h('div', {
                class: 'horizontalresizer',
                onMouseDown: this.handleHorizontalResizerWinrateMouseDown
            }),

            h('svg',
                {
                    viewBox: `0 0 ${width} 100`,
                    preserveAspectRatio: 'none',
                    style: {height: '100%', width: '100%'}
                },

                // Draw background

                h('defs', {},
                    h('linearGradient', {id: 'bgGradient', x1: 0, y1: invert ? 1 : 0, x2: 0, y2: invert ? 0 : 1},
                        h('stop', {
                            offset: '0%',
                            'stop-color': 'white',
                            'stop-opacity': 0.7
                        }),
                        h('stop', {
                            offset: '100%',
                            'stop-color': 'white',
                            'stop-opacity': 0.1
                        })
                    ),
                ),

                h('rect', {
                    x: 0,
                    y: 0,
                    width,
                    height: 100,
                    fill: 'url(#bgGradient)',
                    'clip-path': 'url(#clipGradient)'
                }),

                // Draw guiding lines

                h('line', {
                    x1: 0,
                    y1: 50,
                    x2: width,
                    y2: 50,
                    stroke: '#aaa',
                    'stroke-width': 1,
                    'stroke-dasharray': 2,
                    'vector-effect': 'non-scaling-stroke'
                }),

                [...Array(width)].map((_, i) => {
                    if (i === 0 || i % 50 !== 0) return

                    return h('line', {
                        x1: i,
                        y1: 0,
                        x2: i,
                        y2: 100,
                        stroke: '#aaa',
                        'stroke-width': 1,
                        'stroke-dasharray': 2,
                        'vector-effect': 'non-scaling-stroke'
                    })
                }),

                // Current position marker

                h('line', {
                    x1: currentIndex,
                    y1: 0,
                    x2: currentIndex,
                    y2: 100,
                    stroke: '#0082F0',
                    'stroke-width': 2,
                    'vector-effect': 'non-scaling-stroke'
                }),

                h('path', {
                    fill: '#eee',
                    stroke: '#ccc',
                    'stroke-width': 1,
                    'stroke-dasharray': 1,
                    'vector-effect': 'non-scaling-stroke',

                    d: data.map((x, i) => {
                        if (i === 0) return ''

                        if (x != null && data[i] != undefined)
                            return `M ${(i - 0.5) * scale}, ${100 - data[i]}, L${(i - 0.5) * scale}, 100, L${(i + 0.5) * scale} , 100, L${(i + 0.5) * scale}, ${100 - data[i]}`

                        return ''
                    }).join(' ')
                })
            ),

            // Draw marker

            data[currentIndex] && h('div', {
                class: 'marker',
                style: {
                    left: `${currentIndex * 100 / width}%`,
                    top: `${data[currentIndex]}%`
                },
                title: t(p => `White winrate: ${p.whiteWinrate}%${
                    p.diff == null ? '' : ` (${p.diff >= 0 ? '+' : ''}${p.diff})`
                }`, {
                    whiteWinrate: Math.round((100 - data[currentIndex]) * 100) / 100,
                    diff: dataDiff[currentIndex] == null
                        ? null
                        : -Math.round(dataDiff[currentIndex] * 100) / 100
                })
            })
        )
    }
}

module.exports = WinrateGraph
