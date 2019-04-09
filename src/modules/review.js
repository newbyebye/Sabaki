const gtplogger = require('../modules/gtplogger')
const gtp = require('@sabaki/gtp')
const EngineSyncer = require('../modules/enginesyncer')
const i18n = require('../i18n')
const {ipcRenderer, remote} = require('electron')
const setting = remote.require('./setting')
const gametree = require('./gametree')
const helper = require('../modules/helper')
const sgf = require('@sabaki/sgf')
const alpha = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'

class ReviewEngine {
    constructor(engine, app) {
        this.engine = engine
        this.busy = false
        this.app = app
        this.sign = 0
        this.analyze_command = null
    }

    start() {
            let engine = this.engine
            let syncer = new EngineSyncer(engine)
            this.attachedEngineSyncer = syncer

            syncer.on('busy-changed', () => {
                this.busy = syncer.busy
            })

            syncer.controller.on('command-sent', evt => {
                gtplogger.write({
                    type: 'stdin',
                    message: gtp.Command.toString(evt.command),
                    sign: 0,
                    engine: engine.name
                })

                this.handleCommandSent(Object.assign({syncer}, evt))
            })

            syncer.controller.on('stderr', ({content}) => {
                gtplogger.write({
                    type: 'stderr',
                    message: content,
                    sign:  this.sign,
                    engine: engine.name
                })

                if (content.length == 0) {
                    return
                }

                this.app.setState(({consoleLog}) => ({
                        consoleLog: [...consoleLog, {
                            sign: this.sign,
                            name: engine.name,
                            analyze_command: this.analyze_command,
                            response: {content, internal: true}
                        }]
                    }))
            })

            syncer.controller.on('started', () => {
                gtplogger.write({
                    type: 'meta',
                    message: 'Engine Started',
                    sign: 0,
                    engine: engine.name
                })
                // startreview
                this.startReview()
            })

            
            syncer.controller.on('stopped', () =>  {
                gtplogger.write({
                    type: 'meta',
                    message: 'Engine Stopped',
                    sign: 0,
                    engine: engine.name
                })
            })
            
            syncer.controller.start()
    }

    async startReview() {
        let {gameTrees, gameIndex} = this.app.state
        let tree = gameTrees[gameIndex]
        await this.attachedEngineSyncer.sync(tree, tree.root.id)
        this.app.setState({treePosition: tree.root.id})
        await this.reviewOneStep(tree.root, tree.root.children[0])
    }

    async reviewOneStep(parent, node) {
        let {gameTrees, gameIndex} = this.app.state
        let tree = gameTrees[gameIndex]

        let data = node.data
        let treePosition = node.id
        let board = gametree.getBoard(tree, treePosition)

        let sign = 0
        for (let prop of ['B', 'W', 'AB', 'AW']) {
            if (node.data[prop] == null) continue
            sign = prop.slice(-1) === 'B' ? 1 : -1
        }
        this.sign = sign

        let color = sign == 1 ? "B" : "W"

        if (color !== "") {
            let {controller} = this.attachedEngineSyncer

            // before analyze
            let interval = setting.get('board.analysis_interval').toString()
            this.analyze_command = {name: 'lz-analyze', args: [color, interval], id: node.id};
            await controller.sendCommand({name: 'lz-analyze', args: [color, interval]})
            
            // move to current
            console.log("move to node: ", node)
            this.analyze_command = null;
            await this.attachedEngineSyncer.sync(tree, treePosition)
            
            let analysis = this.app.state.consoleLog
                    .filter(x => x.analyze_command != null && x.analyze_command.id == node.id)
                    .map(x => {
                        x.response.content = x.response.content.trim()
                        let matchNN = x.response.content.match(/NN eval=/)
                        if (matchNN != null) {
                            return {winrate: 100 * parseFloat(x.response.content.split("NN eval=")[1])}
                        }

                        let matchPV = x.response.content.match(/PV: (pass|[A-Za-z]\d+)(\s+(pass|[A-Za-z]\d+))*\s*$/)
                        if (matchPV == null) {
                            return null
                        }

                        let matchPass = matchPV[0].match(/pass/)
                        let pv = []
                        if (matchPass == null) {
                            pv = matchPV[0].split(/\s+/).slice(1)
                        } else {
                            pv = matchPV[0].slice(0, matchPass.index).split(/\s+/).slice(1)
                        }

                        let header = x.response.content.slice(0, matchPV.index)
                        let matchMove = header.match(/[A-T][\d]* ->/)
                        if (matchMove == null) {
                            return null
                        }

                        let move = matchMove[0].split(" ")[0]

                        let matchV = header.match(/V:[ ]*[\d.]*/)
                        let winrate = matchV[0].split(/V:[ ]*/)[1]

                        let matchN = header.match(/N:[ ]*[\d.]*/)
                        let prior = matchN[0].split(/N:[ ]*/)[1]

                        let matchVisit = header.split("->")[1].match(/[\d]+/)

                        return {pv: pv, prior: parseFloat(prior), 
                            winrate: parseFloat(winrate), 
                            visits: parseInt(matchVisit[0]),
                            variation: pv.map(x => board.coord2vertex(x)),
                            sign: sign}
                    })
                    .filter(x => x != null)

            let winrate = analysis[0].winrate
            analysis = analysis.slice(1)
            console.log("winrate: ", winrate, "pv", analysis);

            analysis =  analysis.map(x => {
                    return "sign " + sign + " visits " + x.visits + " winrate " + x.winrate + " prior " +
                        x.prior + " pv " + x.variation.map(x => sgf.stringifyVertex(x).toUpperCase()).join(" ")                 
                })

            // record black win rate
            if (sign < 0) winrate = 100 - winrate

            let newTree = tree.mutate(draft => {
                draft.updateProperty(parent.id, 'SBKV', [winrate.toFixed(2)])
                draft.updateProperty(treePosition, 'GOPV', analysis)
            })

            this.app.setCurrentTreePosition(newTree, treePosition)
        }
        
        if (node.children.length == 0) {
            // the last step
            return
        }

        for (let child of node.children) {
            await this.reviewOneStep(node, child)
        }
    }


    //handleAnalysisInfo

    handleCommandSent({syncer, command, subscribe, getResponse}) {
        console.log( "enter handle command send.....")
        let sign = 0
        let t = i18n.context('app.engine')

        let {treePosition} = this.app.state
        let entry = {sign, name: syncer.engine.name, command, waiting: true}
        let maxLength = setting.get('console.max_history_count')


        this.app.setState(({consoleLog}) => {
            let newLog = consoleLog.slice(Math.max(consoleLog.length - maxLength + 1, 0))
            newLog.push(entry)
            return {consoleLog: newLog}
        })

        let updateEntry = update => {
            Object.assign(entry, update)
            this.app.setState(({consoleLog}) => ({consoleLog}))
        }

        subscribe(({line, response, end}) => {
            updateEntry({
                response: Object.assign({}, response),
                waiting: !end
            })

            gtplogger.write({
                type: 'stdout',
                message: line,
                sign: 0,
                engine: syncer.engine.name
            })
        })

        getResponse()
        .catch(_ => {
            gtplogger.write({
                type: 'meta',
                message: 'Connection Failed',
                sign: this.attachedEngineSyncers.indexOf(syncer) === 0 ? 1 : -1,
                engine: syncer.engine.name
            })

            updateEntry({
                response: {internal: true, content: t('connection failed')},
                waiting: false
            })
        })
    }
}

module.exports = ReviewEngine