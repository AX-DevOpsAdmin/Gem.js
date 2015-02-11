var jss = require("../external/jss")
var proto = require('proto')
var HashMap = require('hashmap') // .HashMap // weirdly, it looks like this is being treated like an AMD module

var utils = require("./utils")

var baseClassName = '_ComponentStyle_' // the base name for generated class names
var nextClassNumber = 0

// creates a style object

var Style = module.exports = proto(function() {

    this.defaultClassName = '_default_'     // the name of the default class (used to prevent style inheritance)

    // styleDefinition is an object where key-value pairs can be any of the following:
    // <ComponentName>: the value can either be a Style object or a nested styleDefinition object
    // $setup: the value is a function to be run on a component when the style is applied to it
    // $kill: the value is a function to be run on a component when a style is removed from it
    // '$': the value describes css styles inside the component - it should be an object with the following form:
        // cssStyle: the value should be a valid css value for that style attribute
        // classname: the value should be an object containing an object of the same form as the '$' value
    this.init = function(styleDefinition, privateOptions) {
        if(privateOptions === undefined) privateOptions = {}
        if(privateOptions.inLabel===undefined) inLabel = false

        this.className = baseClassName+nextClassNumber
        nextClassNumber++

        this.componentStyleMap = {}
        this.labelStyleMap = {}

        var labelStyles = {}
        var pseudoClassStyles = {}
        var cssProperties = {}
        for(var key in styleDefinition) {
            var value = styleDefinition[key]

            if(key === '$setup') {
                if(!(value instanceof Function)) throw new Error("$setup key must be a function ('setup' can't be used as a label)")
                this.setup = value

            } else if(key === '$kill') {
                if(!(value instanceof Function)) throw new Error("$kill key must be a function ('kill' can't be used as a label)")
                this.kill = value

            } else if(key === '$state') {
                if(!(value instanceof Function)) throw new Error("$state key must be a function ('$state' can't be used as a label)")
                this.stateHandler = value

            } else if(key.indexOf('$$') === 0) { // pseudo-class style
                var pseudoClass = mapCamelCase(key.substr(2))
                if(pseudoClass === '') {
                    throw new Error("Empty pseudo-class name not valid (style key '$$')")
                }

                utils.merge(pseudoClassStyles, flattenPseudoClassStyles(pseudoClass, value))

            } else if(key.indexOf('$') === 0) {   // label style
                if(privateOptions.inLabel)
                    throw new Error("Can't create nested label style "+key+" because components can only have one label")

                var label = key.substr(1)
                if(label === '') {
                    throw new Error("Empty label name not valid (style key '$')")
                }

                labelStyles[label] = value

            } else if(isStyleObject(value)) {
                this.componentStyleMap[key] = value

            } else if(value instanceof Object) {
                this.componentStyleMap[key] = Style(value)  // turn the object description into a full fledged style object
            } else {
                var cssStyle = key
                var cssStyleName = mapCamelCase(cssStyle)
                cssProperties[cssStyleName] = cssValue(cssStyleName, value)
            }
        }

        jss.set('.'+this.className, cssProperties) // create the css class

        if(module.exports.isDev) {
            this.styleDefinitions = {}
            this.styleDefinitions['.'+this.className] = cssProperties
        }

        // create label styles
        if(Object.keys(labelStyles).length > 0) {
            var baseStyle = utils.merge({}, cssProperties, this.componentStyleMap)

            for(var label in labelStyles) {
                if(isStyleObject(labelStyles[label])) {
                    this.labelStyleMap[label] = labelStyles[label]
                } else {
                    var mergedStyle = utils.merge({}, baseStyle, labelStyles[label])
                    this.labelStyleMap[label] = Style(mergedStyle, {inLabel:true})
                }
            }
        }

        // create pseudoclass styles
        if(Object.keys(pseudoClassStyles).length > 0) {

            // create a two-level map where the top-level keys are emulatable psuedo classes, and non-emulatable pseudo classes are at the second level
            // the classes will also be sorted and deduped
            var tieredPseudoClasses = {} // the two-level map
            for(var key in pseudoClassStyles) {
                var value = pseudoClassStyles[key]

                // split key into pseudoclass list
                var pseudoClassList = key.split(":")
                var emulatablePseudoClasses = []
                var nonEmulatablePseudoClasses = []
                for(var n in pseudoClassList) {
                    var pseudoClass = pseudoClassList[n]
                    var pseudoClassParts = getPseudoClassParts(pseudoClass)
                    if(pseudoClassParts.class in emulatedPseudoClasses) {
                        emulatablePseudoClasses.push(pseudoClass)
                    } else {
                        nonEmulatablePseudoClasses.push(pseudoClass)
                    }
                }

                if(emulatablePseudoClasses.length === 0) { // if none of the pseudoclasses can be emulated using javascript
                    validatePurePseudoClassStyles(key, value)                        // then validate the value and
                    createPseudoClassRules(this, key, '.'+this.className+":"+key, value)   // create pseudoClassRules

                } else { // if some of the pseudoclasses can be emulated using javascript

                    emulatablePseudoClasses.sort()
                    var emulatablePseudoClassKey = emulatablePseudoClasses.join(':')
                    if(tieredPseudoClasses[emulatablePseudoClassKey] === undefined)
                        tieredPseudoClasses[emulatablePseudoClassKey] = {}

                    if(nonEmulatablePseudoClasses.length === 0) {
                        utils.merge(tieredPseudoClasses[emulatablePseudoClassKey], value)
                    } else {
                        nonEmulatablePseudoClasses.sort()
                        var nonEmulatablePsuedoClassKey = nonEmulatablePseudoClasses.join(':')

                        var secondTier = {}
                        secondTier['$$'+nonEmulatablePsuedoClassKey] = value

                        utils.merge(tieredPseudoClasses[emulatablePseudoClassKey], secondTier)
                    }
                }
            }

            // make combinations of the emulatable pseudoclasses, so that they combine like the non-emulated ones do
            // info about mathematical combination: https://en.wikipedia.org/wiki/Combination

            var tieredPseudoClassesKeys = Object.keys(tieredPseudoClasses).reverse().map(function(v) {    // reverse first so that more specific pseudoclasses go first
                return {key: v, parts: v.split(':')} // so it doesn't have to split every time
            })

            for(var n=0; n<tieredPseudoClassesKeys.length; n++) {
                var keyA = tieredPseudoClassesKeys[n]
                for(var k=2; k <= tieredPseudoClassesKeys.length; k++) { // k is the number of psuedoclasses to combine
                    for(var j=n+1; j<tieredPseudoClassesKeys.length-(k-2); j++) {
                        var result = combinePseudoclasses(tieredPseudoClasses, [keyA].concat(tieredPseudoClassesKeys.slice(j, k)))
                        if(result.key in tieredPseudoClasses) {
                            utils.merge(tieredPseudoClasses[result.key], result.value)
                        } else { // new key
                            tieredPseudoClasses[result.key] = result.value
                        }
                    }
                }
            }

            // turn the emulatable pseudo classes into Style objects
            // also build up the set of psuedoclasses that will be emulated
            // also build up a map of pseudoclasses-to-emulate to the emulation functions for those pseudoclasses
            var pseudoClasesToEmulate = []
            var preSplitPseudoClasses = [] // a list where each element looks like: [pseudoClassList, styleObject]  (this is primarily for performance - so we don't have to split the key every time we check for state changes)
            var pseudoClassesToEmulationInfo = {}
            for(var key in tieredPseudoClasses) {
                if(isStyleObject(tieredPseudoClasses[key])) {
                    tieredPseudoClasses[key] = tieredPseudoClasses[key]
                } else {
                    var newStyle = Style(utils.merge({}, cssProperties, tieredPseudoClasses[key])) // pseudoClassStyles merged with parent css styles

                    // merge in componentStyleMap and labelStyleMap
                    for(var k in this.componentStyleMap) {
                        if(newStyle.componentStyleMap[k] === undefined)
                            newStyle.componentStyleMap[k] = this.componentStyleMap[k]
                    }
                    for(var k in this.labelStyleMap) {
                        if(newStyle.labelStyleMap[k] === undefined)
                            newStyle.labelStyleMap[k] = this.labelStyleMap[k]
                    }

                    tieredPseudoClasses[key] = newStyle
                }


                var pseudoClassList = key.split(":")
                for(var n=0; n<pseudoClassList.length; n++) {
                    var pseudoClass = pseudoClassList[n]
                    if(pseudoClasesToEmulate.indexOf(pseudoClass) === -1) {
                        pseudoClasesToEmulate.push(pseudoClass)

                        var pseudoClassParts = getPseudoClassParts(pseudoClass)
                        var fns = emulatedPseudoClasses[pseudoClassParts.class]
                        var info = {fns: fns}
                        if(fns.processParameter !== undefined) {
                            info.parameter = fns.processParameter(pseudoClassParts.parameter)
                        }
                        pseudoClassesToEmulationInfo[pseudoClass] = info
                    }
                }

                preSplitPseudoClasses.push([pseudoClassList, tieredPseudoClasses[key]])
            }

            // create functions that initialize and keep track of state
            var initializeState = function(component) {
                var state = {}
                for(var n=0; n<pseudoClasesToEmulate.length; n++) {
                    var pseudoClass = pseudoClasesToEmulate[n]
                    var pseudoClassEmulationInfo = pseudoClassesToEmulationInfo[pseudoClass]
                    state[pseudoClass] = pseudoClassEmulationInfo.fns.check(component, pseudoClassEmulationInfo.parameter)
                }

                return state
            }

            var that = this
            var changeStyleIfNecessary = function(currentStyle, component, state) {
                var longestMatchingLength = 0;
                var mostSpecificMatchingStyle = that; // if nothing else matches, change back to the base style object
                for(var n=0; n<preSplitPseudoClasses.length; n++) {
                    var pseudoClassList = preSplitPseudoClasses[n][0]
                    for(var j=0; j<pseudoClassList.length; j++) {
                        if(!state[pseudoClassList[j]]) {
                            break;
                        }
                    }

                    if(j === pseudoClassList.length && j > longestMatchingLength) {
                        longestMatchingLength = j
                        mostSpecificMatchingStyle = preSplitPseudoClasses[n][1]
                    }
                }

                if(mostSpecificMatchingStyle !== currentStyle) {
                    component.style = mostSpecificMatchingStyle
                }
            }

            // setup pseudoclass emulation with $setup and $kill handlers

            var wrapSetupAndKill = function(style) {
                var originalSetup = style.setup
                style.setup = function(component) {
                    var that = this

                    this._styleSetupStates = {} // maps pseudoClass to setupState
                    var state = initializeState(component)
                    for(var pseudoClass in pseudoClassesToEmulationInfo) {
                        ;(function(pseudoClass, emulationInfo){   // close over those variables (so they keep the value they had when the function was setup)
                            that._styleSetupStates[pseudoClass] = emulationInfo.fns.setup(component, function() { // start
                                state[pseudoClass] = true
                                changeStyleIfNecessary(that, component, state)
                            }, function() { // end
                                state[pseudoClass] = false
                                changeStyleIfNecessary(that, component, state)
                            }, emulationInfo.parameter)

                        })(pseudoClass, pseudoClassesToEmulationInfo[pseudoClass])
                    }

                    changeStyleIfNecessary(that, component, state)

                    if(originalSetup !== undefined) {
                        originalSetup.apply(this, arguments)
                    }
                }

                var originalKill = style.kill
                style.kill = function(component) {
                    for(var pseudoClass in pseudoClassesToEmulationInfo) {
                        var emulationInfo = pseudoClassesToEmulationInfo[pseudoClass]
                        emulationInfo.fns.kill(component, this._styleSetupStates[pseudoClass])
                    }

                    if(originalKill !== undefined) {
                        originalKill.apply(this, arguments)
                    }
                }
            }

            // wrap all the setup and kill functions

            for(var key in tieredPseudoClasses) {
                var style = tieredPseudoClasses[key]
                wrapSetupAndKill(style)
            }

            wrapSetupAndKill(this)
        }
    }

    // instance properties

    this.className          // the css classname for this style
    this.componentStyleMap; // maps a Component name to a Style object for that component
    this.labelStyleMap;     // maps a label name to a Style object for that label
    this.setup;             // run some javascript on any element this class is applied to
    this.kill;              // a function to run on removal of the style (should reverse setup)

    // gets the style object for a component (takes into account whether the component has a label
    this.get = function(component) {
        if(component.label !== undefined) {
            var labelStyle = this.labelStyleMap[component.label]
            if(labelStyle !==  undefined) {
                return labelStyle
            }
        }
        // else
        return this
    }
})


// private


// keys is a list of objects where each object has the members:
    // key - the original string key
    // parts - the key split by ":"
// returns an object with the following members:
    // key - the new combined key
    // value - the new merged value
var combinePseudoclasses = function(pseudoclasses, keys) {
    var resultKeyParts = keys[0].parts
    var resultValue = utils.merge({}, pseudoclasses[keys[0].key]) // make a copy
    for(var n=1; n<keys.length; n++) {
        var key = keys[n]
        // merge all psuedoclasses that don't already exist into the resultKey
        for(var j=0; j<key.parts.length; j++) {
            var part = key.parts[j]
            if(resultKeyParts.indexOf(part) === -1) {
                resultKeyParts.push(part)
            }
        }

        // merge the value into resultValue
        utils.merge(resultValue, pseudoclasses[key.key])
    }

    return {key: resultKeyParts.join(':'), value: resultValue}
}

// a map of pseudoclass names and how they are emulated with javascript
// each pseudoclass sets up the following functions:
    // check - a function that checks if that pseudoclass currently applies to the component when its called
    // setup - calls a callback when the pseudoClass starts and stops applying
        // should return an object that will be passed to the kill function (as its 'state' parameter)
    // kill - cleans up anything set up in the 'setup' function
    // processParameter - takes the pseudoclass parameter and returns some object representing it that will be used by the setup and check functions
var emulatedPseudoClasses = {
    hover: {
        check: function(component) {
            var nodes = document.querySelectorAll( ":hover" )
            for(var n=0; n<nodes.length; n++) {
                if(nodes[n] === component.domNode) {
                    return true
                }
            }
            return false
        },
        setup: function(component, startCallback, endCallback) {
            component.domNode.addEventListener("mouseover", startCallback)
            component.domNode.addEventListener("mouseout", endCallback)

            return {start: startCallback, end: endCallback}
        },
        kill: function(component, state) {
            component.domNode.removeEventListener("mouseover", state.start)
            component.domNode.removeEventListener("mouseout", state.end)
        }
    },
    checked: {
        check: function(component) {
            return component.val()
        },
        setup: function(component, startCallback, endCallback) {
            var setupState = {}
            component.on("change", setupState.listener = function() {
                if(component.val()) {
                    startCallback()
                } else {
                    endCallback()
                }
            })

            return setupState
        },
        kill: function(component, state) {
            component.removeListener("change", state.listener)
        }
    },
    required: {
        check: function(component) {
            return component.attr('required') !== null
        },
        setup: function(component, startCallback, endCallback) {
            var observer = new MutationObserver(function() {
                if(component.attr('required') !== null) {
                    startCallback()
                } else {
                    endCallback()
                }
            })

            observer.observe(component.domNode, {attributes: true})

            return {observer: observer}
        },
        kill: function(component, state) {
            state.observer.disconnect()
        }
    },
    'last-child': {
        check: function(component) {
            return nthLastChildCheck(component, '1')
        },
        setup: function(component, startCallback, endCallback) {
            var observer = new MutationObserver(function() {
                if(nthLastChildCheck(component, '1')) {
                    startCallback()
                } else {
                    endCallback()
                }
            })

            var setupObserver = function() {
                // note that since this uses the component parent rather than domNode.parentNode, this won't work for components added to non-component nodes (and there's no good way to do it, because you would have to poll for parent changes)
                observer.observe(component.parent.domNode, {childList: true})
            }

            if(component.parent !== undefined) {
                setupObserver()
            }

            component.on('newParent', function() {
                setupObserver()
            })
            component.on('parentRemoved', function() {
                observer.disconnect()
            })

            return {observer: observer}
        },
        kill: function(component, state) {
            state.observer.disconnect()
        }
    },
    'nth-child': {
        // todo: support full an+b parameters for nth-child https://developer.mozilla.org/en-US/docs/Web/CSS/:nth-child
        check: function(component, parameterCheck) {
            return nthChildCheck(component, parameterCheck)
        },
        setup: function(component, startCallback, endCallback, parameterCheck) {

            var checkAndCallCallbacks = function() {
                if(nthChildCheck(component, parameterCheck)) {
                    startCallback()
                } else {
                    endCallback()
                }
            }

            var observer = new MutationObserver(function() {
                checkAndCallCallbacks()
            })

            var setupObserver = function() {
                // note that since this uses the component parent rather than domNode.parentNode, this won't work for components added to non-component nodes (and there's no good way to do it, because you would have to poll for parent changes)
                observer.observe(component.parent.domNode, {childList: true})
            }

            if(component.parent !== undefined) {
                setupObserver()
            }

            component.on('newParent', function() {
                setupObserver()
                checkAndCallCallbacks()
            })
            component.on('parentRemoved', function() {
                observer.disconnect()
                checkAndCallCallbacks()
            })

            return {observer: observer}
        },
        kill: function(component, state) {
            state.observer.disconnect()
        },
        processParameter: function(parameter) {
            return nthChildParameterFn(parameter)
        }
    },

    // not's parameter is a statement consisting of pseudoclasses separated either by & or ,
    // $$not(pseudoclass1&pseudoclass2,psuedoclass3) translates to the css :not(:pseudoclass1:pseudoclass2,:psuedoclass3)
    /*not: {
        check: function() {

        },
    }*/
}

// name is the name of the new pseudoclass
// fns is an object with the members:
    // check(component) - returns true if the pseudoclass applies to the component
    // setup(component, startCallback, endCallback, parameter) - a function that should call startCallback when the pseudoclass starts applying, and endCallback when it stops applying
        // parameter - the parameter passed to the pseudoclass (e.g. in :not(:first-child), ":first-child" is the parameter)
    // kill - a function that cleans up any event listeners or anything else set up in the 'setup' function
module.exports.addPseudoClass = function(name, fns) {
    if(emulatedPseudoClasses[name] !== undefined) throw new Error("The pseudoclass '"+name+"' is already defined.")
    // else
    emulatedPseudoClasses[name] = fns
}


function nthChildCheck(component, testFn) {
    if(component.domNode.parentNode === null)
        return false

    var children = component.domNode.parentNode.children                    // must be domNode.parentNode, because child nodes may not be Components
    var index = Array.prototype.indexOf.call(children, component.domNode)
    return testFn(index)
}

function nthLastChildCheck(component, parameter) {
    if(component.domNode.parentNode === null)
        return false

    var children = component.domNode.parentNode.children                    // must be domNode.parentNode, because child nodes may not be Components
    var index = children.length - parseInt(parameter)
    return children[index] === component.domNode
}

// returns a function that takes an index and tell you if that index applies to the nthChildParameter
var nthChildParameter = /^(((-?\d*)(([+-]\d*)n?)?)|((-?\d)*n?([+-]\d*)?))$/
function nthChildParameterFn(parameter) {
    var parts = parameter.match(nthChildParameter)
    if(parts === null)
        throw new Error("nth-child parameter '"+parameter+"' isn't valid")

    if(parts[2] !== undefined) {
        var constant = parts[3]
        var variable = parts[5]
    } else {
        var constant = parts[8]
        var variable = parts[7]
    }

    if(constant === undefined) constant = 0
    else                       constant = parseInt(constant)
    if(variable === undefined) variable = 0
    else                       variable = parseInt(variable)

    if(variable === 0) {
        return function(index) {
            return index+1 === constant
        }
    } else {
        return function(index) {
            return ((index+1-constant)/variable) % 1 === 0
        }
    }

}

// maps a style value to a css value
// style values that are numbers are mapped to strings, usually with px postfix
function cssValue(cssStyleName, value) {
    // If a number was passed in, add 'px' to the (except for certain CSS properties) [also taken from jquery's code]
    if(typeof(value) === "number" && cssNumber[cssStyleName] === undefined) {
        return value+"px"
    } else {
        return value.toString()
    }
}

function createPseudoClassRules(that, pseudoClass, selector, pseudoClassStyle) {

    var pseudoClassCss = {}
    for(var key in pseudoClassStyle) {
        var value = pseudoClassStyle[key]

        if(!(value instanceof Object)) {
            var cssStyle = key
            var cssStyleName = mapCamelCase(cssStyle)
            pseudoClassCss[cssStyleName] = cssValue(cssStyleName, value)
        } else {
            throw new Error("All properties within the pseudoclasses '"+pseudoClass+"' must be css styles")
        }
    }

    // create immediate pseudo class style
    jss.set(selector, pseudoClassCss) // create the css class with the pseudoClass

    if(module.exports.isDev) {
        that.styleDefinitions = {}
        that.styleDefinitions[selector] = pseudoClassCss
    }
}

// throws exceptions for various style configurations that are unsupported by pure pseudo classes (ones that can't be emulated usuing javascript)
function validatePurePseudoClassStyles(pseudoClass, pseudoClassStyles) {
    for(var key in pseudoClassStyles) {
        var value = pseudoClassStyles[key]

        if(isStyleObject(value)) {
            throw new Error("Can't set the pseudoclasses '"+pseudoClass+"' to a Style object")
        } else if(key === '$setup') {
            throw new Error("$setup can't be used within the pseudoclasses '"+pseudoClass+"'")
        } else if(key === '$kill') {
            throw new Error("$kill can't be used within the pseudoclasses '"+pseudoClass+"'")
        } else if(key.indexOf('$') === 0) {   // label style
            throw new Error("Component labels can't be used within the pseudoclasses '"+pseudoClass+"'")
        }
    }
}

// e.g. pulls out 'nth-child' and '2+3n' from 'nth-child(2+3n)'
var pseudoClassRegex = /^([^(]*)(\((.*)\))?$/
function getPseudoClassParts(fullPsuedoClass) {
    var x = fullPsuedoClass.match(pseudoClassRegex)
    if(x === null) throw new Error("Pseudoclass '"+fullPsuedoClass+"' is invalid")
    return {class: x[1], parameter: x[3]}
}


// takes in a list of pseudoClassRules and changes any nesting like {hover: {focus: {}}} into something like {hover: {}, "hover:focus": {}}
// also does some validation
function flattenPseudoClassStyles(pseudoClass, pseudoClassStyle) {
    var nonPseudoClassStyles = {}
    var subpseudoClasses = {}
    for(var key in pseudoClassStyle) {
        var value = pseudoClassStyle[key]

        if(key.indexOf('$$') === 0) { // pseudo-class style
            var subPseudoClass = key.substr(2)
            if(subPseudoClass === '') {
                throw new Error("Empty pseudo-class name not valid (style key '$$')")
            }

            subpseudoClasses[subPseudoClass] = value
        } else {
            nonPseudoClassStyles[key] = value
        }
    }

    // create flattened styles (with merged in styles from its parent pseudoclass
    var flattenedStyles = {}
    for(var subPseudoClass in subpseudoClasses) {
        var value = subpseudoClasses[subPseudoClass]

        if(isStyleObject(value)) {
            flattenedStyles[pseudoClass+":"+subPseudoClass] =  value
        } else {
            utils.merge(flattenedStyles, flattenPseudoClassStyles(pseudoClass+":"+subPseudoClass, utils.merge({}, nonPseudoClassStyles, value)))
        }
    }

    // write the top-level pseudoClass
    flattenedStyles[pseudoClass] = nonPseudoClassStyles

    return flattenedStyles
}


// taken from jquery's code
var cssNumber = {
    "column-count": 1,
    "fill-opacity": 1,
    "flex-grow": 1,
    "flex-shrink": 1,
    "font-weight": 1,
    "line-height": 1,
    "opacity": 1,
    "order": 1,
    "orphans": 1,
    "widows": 1,
    "z-index": 1,
    "zoom": 1
}

function isStyleObject(o) {
    return o.componentStyleMap !== undefined && o.componentStyleMap !== undefined
}


var asciiA = 'A'.charCodeAt(0), asciiZ = 'Z'.charCodeAt(0), difference = 'a'.charCodeAt(0) - asciiA
function mapCamelCase(cssStyleName) {
    for(var n=0; n<cssStyleName.length; n++) {
        var ascii = cssStyleName.charCodeAt(n)
        if(asciiA <= ascii && ascii <= asciiZ) { // found capital letter
            cssStyleName = cssStyleName.slice(0, n) + '-'+String.fromCharCode(ascii+difference) + cssStyleName.slice(n+1)
            n++ // increment a second time for the dash
        }
    }

    return cssStyleName
}

// maps all the styles that are inherited by descendant nodes to their default values
// source: http://stackoverflow.com/questions/5612302/which-css-styles-are-inherited
var defaultStyleValues = {
    'azimuth': 'center',
    'border-collapse': 'separate',
    'border-spacing': '0',
    'caption-side': 'top',
    //'color': 'black',         // let this inherit
    //'cursor': 'auto',         // let this one inherit - its weird otherwise
    'direction': 'ltr',
     display: 'inline-block', // changes the default display to inline-block
    'elevation': '',
    'empty-cells': 'show',
    // 'font-family': '',       // let this inherit
    // 'font-size': 'medium',   // let this inherit
    //'font-style': 'normal',   // let this inherit
    //'font-variant': 'normal', // let this inherit
    //'font-weight': 'normal',  // let this inherit
    'letter-spacing': 'normal',
    'line-height': 'normal',
    'list-style-image': 'none',
    'list-style-position': 'outside',
    'list-style-type': 'disc',
    'orphans': '2',
    'pitch-range': '',
    'pitch': '',
     position: 'relative', // changes the default positioning so that absolute is relative to its parent by default
    'quotes': '',
    'richness': '',
    'speak-header': '',
    'speak-numeral': '',
    'speak-punctuation': '',
    'speak': '',
    'speak-rate': '',
    'stress': '',
    'text-align': 'left',
    'text-indent': '0',
    'text-transform': 'none',
    'visibility': 'visible',
    'voice-family': '',
    'volume': '',
    'white-space': 'normal',
    'widows': '2',
    'word-spacing': 'normal'
}

jss.set('.'+Style.defaultClassName, defaultStyleValues) // creates default css class in order to prevent inheritance

jss.set('input', { // chrome and firefox user agent stylesheets mess with this otherwise
    cursor: 'inherit'
})

/*private*/ module.exports.isDev; // should be set by Component

var computedStyles = module.exports.computedStyles = new HashMap() // stores a map from styleMap components, to the combined style map