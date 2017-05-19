// tslint:disable:align whitespace no-trailing-whitespace
import * as request from "request";
import * as url from "url";
// import * as Geometry from "./geometry";
import * as api from "../../api";
import { MergeTreeChunk } from "../../api";
import * as SharedString from "../../merge-tree";
import * as socketStorage from "../../socket-storage";

socketStorage.registerAsDefault(document.location.origin);

// first script loaded
let clockStart = Date.now();

enum CharacterCodes {
    _ = 95,
    $ = 36,

    ampersand = 38,             // &
    asterisk = 42,              // *
    at = 64,                    // @
    backslash = 92,             // \
    bar = 124,                  // |
    caret = 94,                 // ^
    closeBrace = 125,           // }
    closeBracket = 93,          // ]
    closeParen = 41,            // )
    colon = 58,                 // : 
    comma = 44,                 // ,
    dot = 46,                   // .
    doubleQuote = 34,           // "
    equals = 61,                // =
    exclamation = 33,           // !
    hash = 35,                  // #
    greaterThan = 62,           // >
    lessThan = 60,              // <
    minus = 45,                 // -
    openBrace = 123,            // {
    openBracket = 91,           // [
    openParen = 40,             // (
    percent = 37,               // %
    plus = 43,                  // +
    question = 63,              // ?
    semicolon = 59,             // ;
    singleQuote = 39,           // '
    slash = 47,                 // /
    tilde = 126,                // ~
    _0 = 48,
    _9 = 57,
    a = 97,
    z = 122,

    A = 65,
    Z = 90,
    space = 0x0020,   // " "
}

interface ISegSpan extends HTMLSpanElement {
    seg: SharedString.TextSegment;
    pos?: number;
}

interface IRangeInfo {
    elm: HTMLElement;
    node: Node;
    offset: number;
}

function elmOffToSegOff(elmOff: IRangeInfo, span: HTMLSpanElement) {
    let offset = elmOff.offset;
    let prevSib = elmOff.node.previousSibling;
    if ((!prevSib) && (elmOff.elm !== span)) {
        prevSib = elmOff.elm.previousSibling;
    }
    while (prevSib) {
        switch (prevSib.nodeType) {
            case Node.ELEMENT_NODE:
                let innerSpan = <HTMLSpanElement>prevSib;
                offset += innerSpan.innerText.length;
                break;
            case Node.TEXT_NODE:
                offset += prevSib.nodeValue.length;
                break;
            default:
                break;
        }
        prevSib = prevSib.previousSibling;
    }
    return offset;
}

let cachedCanvas: HTMLCanvasElement;
function getTextWidth(text, font) {
    // re-use canvas object for better performance
    const canvas = cachedCanvas || (cachedCanvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = font;
    const metrics = context.measureText(text);
    return metrics.width;
}

// for now global; later map from font info to width/height estimates
let wEst = 0;
let hEst = 23;

function makeInnerDiv() {
    let innerDiv = document.createElement("div");
    innerDiv.style.font = "18px Times";
    innerDiv.style.lineHeight = "125%";
    innerDiv.onclick = (e) => {
        let div = <HTMLDivElement>e.target;
        if (div.lastElementChild) {
            // tslint:disable-next-line:max-line-length
            console.log(`div click at ${e.clientX},${e.clientY} rightmost span with text ${div.lastElementChild.innerHTML}`);
        }
    };
    return innerDiv;
}

function onCursorStyle(span: HTMLSpanElement) {
    span.style.backgroundColor = "blue";
    span.style.visibility = "visible";
}

function offCursorStyle(span: HTMLSpanElement) {
    span.style.visibility = "hidden";
}

function makeCursor() {
    let editSpan = document.createElement("span");
    editSpan.id = "cursor";
    editSpan.innerText = "\uFEFF";
    onCursorStyle(editSpan);
    return editSpan;
}

function widthEst(fontInfo: string) {
    let innerDiv = makeInnerDiv();
    wEst = getTextWidth("abcdefghi jklmnopqrstuvwxyz", innerDiv.style.font) / 27;
}

function makeScrollLosenge(height: number, left: number, top: number) {
    let div = document.createElement("div");
    div.style.width = "12px";
    div.style.height = `${height}px`;
    div.style.left = `${left}px`;
    div.style.top = `${top}px`;
    div.style.backgroundColor = "pink";
    let bordRad = height / 3;
    div.style.borderRadius = `${bordRad}px`;
    div.style.position = "absolute";
    return div;
}

// TODO: ensure some text shows up in very small viewports
function renderTree(div: HTMLDivElement, pos: number, client: SharedString.Client, context: StringView) {
    div.id = "renderedTree";
    div.style.marginRight = "8%";
    div.style.marginLeft = "5%";
    div.style.marginTop = "5%";
    div.style.marginBottom = "5%";
    div.style.whiteSpace = "pre-wrap";
    let splitTopSeg = true;
    let w = Math.floor(wEst);
    let h = hEst;
    let charsPerLine = window.innerWidth / w;
    let charsPerViewport = Math.floor((window.innerHeight / h) * charsPerLine);
    let innerDiv = makeInnerDiv();
    div.appendChild(innerDiv);
    let charLength = 0;
    let firstSeg = true;
    function renderSegment(segment: SharedString.Segment, segPos: number, refSeq: number,
        clientId: number, start: number, end: number) {
        let segOffset = 0;
        // let prevWord: string;

        function segmentToSpan(segText: string, textSegment: SharedString.TextSegment) {
            let span = <ISegSpan>document.createElement("span");
            if (segText.indexOf("Chapter") >= 0) {
                span.style.fontSize = "140%";
                span.style.lineHeight = "150%";
            } else {
                segText = segText.replace(/_([a-zA-Z]+)_/g, "<span style='font-style:italic'>$1</span>");
            }
            span.innerHTML = segText;
            span.seg = textSegment;
            if (segOffset > 0) {
                span.pos = segOffset;
                segOffset = 0;
            }
            innerDiv.appendChild(span);
            return segText;
        }

        function renderFirstSegment(text: string, textSegment: SharedString.TextSegment) {
            segmentToSpan(text, textSegment);
            let bounds = innerDiv.getBoundingClientRect();
            let x = bounds.left + Math.floor(wEst / 2);
            let y = bounds.top + Math.floor(hEst / 2);
            let offset = 0;
            let prevOffset = 0;
            let segspan = <ISegSpan>innerDiv.children[0];
            do {
                if (y > bounds.bottom) {
                    prevOffset = offset;
                    break;
                }
                let elmOff = pointerToElementOffsetWebkit(x, y);
                if (elmOff) {
                    prevOffset = offset;
                    offset = elmOffToSegOff(elmOff, segspan);
                    y += hEst;
                } else {
                    console.log(`no hit for ${x} ${y} start ${start}`);
                    prevOffset = offset;
                    break;
                }
            } while (offset < start);
            innerDiv.removeChild(segspan);
            offset = prevOffset;
            while ((offset >= 1) && (text.charCodeAt(offset - 1) !== CharacterCodes.space)) {
                offset--;
            }
            return text.substring(offset);
        }

        // function renderFirstSegment(text: string) {
        //     let segLength = 0;
        //     let words = text.split(" ");
        //     segOffset = 0;
        //     console.log("render first");
        //     for (let word of words) {
        //         if (segLength >= start) {
        //             let rightSpan = <ISegSpan>innerDiv.lastElementChild;
        //             let onRightLeftBound = window.innerWidth * 2;
        //             let onRightCharOffset = 0;
        //             while (rightSpan) {
        //                 let bounds = rightSpan.getBoundingClientRect();
        //                 // console.log(`left: ${bounds.left}`);
        //                 if (onRightLeftBound < bounds.left) {
        //                     segOffset = onRightCharOffset;
        //                     break;
        //                 }
        //                 onRightCharOffset = rightSpan.pos;
        //                 let prev = <ISegSpan>rightSpan.previousElementSibling;
        //                 innerDiv.removeChild(rightSpan);
        //                 rightSpan = prev;
        //             }
        //             div.removeChild(innerDiv);
        //             div.appendChild(makeInnerDiv());
        //             break;
        //         } else {
        //             let span = <ISegSpan>document.createElement("span");
        //             word = word.replace(/_([a-zA-Z]+)_/g, "<span style='font-style:italic'>$1</span>");
        //             if (prevWord) {
        //                 // TODO: handle multi-space separators; incorporate separator as preceding word
        //                 // as in view as sequence of /\s*\w+/ with a trailing \s*
        //                 word = " " + word;
        //             }
        //             prevWord = word;
        //             span.innerHTML = word;
        //             innerDiv.appendChild(span);
        //             span.pos = segLength;
        //             segLength += word.length;
        //         }
        //     }
        //     return text.substring(segOffset);
        // }
        if (segment.getType() === SharedString.SegmentType.Text) {
            let textSegment = <SharedString.TextSegment>segment;
            let last = (textSegment.text.length === end);
            if (firstSeg && (textSegment !== context.prevTopSegment)) {
                splitTopSeg = false;
                context.prevTopSegment = textSegment;
            }
            firstSeg = false;
            let segText = textSegment.text;
            context.adjustedTopChar = context.topChar;
            if ((start > 0) && splitTopSeg) {
                segText = renderFirstSegment(segText, textSegment);
                let actualStart = textSegment.text.length - segText.length;
                if (start !== actualStart) {
                    context.adjustedTopChar = context.topChar + (actualStart - start);
                }
            }
            segText = segmentToSpan(segText, textSegment);
            if (segText.charAt(segText.length - 1) === "\n") {
                innerDiv = makeInnerDiv();
                div.appendChild(innerDiv);
            }
            charLength += segText.length;

            if ((charLength > charsPerViewport) || last) {
                console.log(`client h, w ${div.clientHeight},${div.clientWidth}`);
                let constraint = Math.floor(window.innerHeight * 0.95);

                if (div.clientHeight > constraint) {
                    if (innerDiv.previousElementSibling) {
                        let pruneDiv = <HTMLDivElement>innerDiv.previousElementSibling;
                        let lastPruned: HTMLDivElement;
                        while (pruneDiv) {
                            if (pruneDiv.getBoundingClientRect().bottom > constraint) {
                                let temp = <HTMLDivElement>pruneDiv.previousElementSibling;
                                div.removeChild(pruneDiv);
                                lastPruned = pruneDiv;
                                pruneDiv = temp;
                            } else {
                                break;
                            }
                        }
                        if (lastPruned) {
                            div.appendChild(lastPruned);
                            for (let i = 0; i < lastPruned.childElementCount; i++) {
                                let prunedSpan = <ISegSpan>lastPruned.children[i];
                                let bounds = prunedSpan.getBoundingClientRect();
                                if (bounds.bottom <= constraint) {
                                    innerDiv.appendChild(prunedSpan);
                                } else {
                                    if ((constraint - bounds.top) > hEst) {
                                        let x = bounds.right;
                                        let y = constraint - Math.floor(hEst / 2);
                                        let elmOff = pointerToElementOffsetWebkit(x, y);
                                        let segOff = elmOffToSegOff(elmOff, prunedSpan) + 1;
                                        let textSeg = <SharedString.TextSegment>prunedSpan.seg;
                                        while ((segOff > 0) &&
                                            (textSeg.text.charCodeAt(segOff) !== CharacterCodes.space)) {
                                            segOff--;
                                        }
                                        if (segOff > 0) {
                                            segmentToSpan(textSeg.text.substring(0, segOff), textSeg);
                                        }
                                    }
                                    break;
                                }
                            }
                            div.removeChild(lastPruned);
                        }
                    }
                    return false;
                }
            }
        }
        return true;
    }
    client.mergeTree.mapRange({ leaf: renderSegment }, SharedString.UniversalSequenceNumber,
        client.getClientId(), undefined, pos);
}

export let theString: StringView;

function pointerToElementOffsetWebkit(x: number, y: number): IRangeInfo {
    let range = document.caretRangeFromPoint(x, y);
    if (range) {
        let result = {
            elm: <HTMLElement>range.startContainer.parentElement,
            node: range.startContainer,
            offset: range.startOffset,
        };
        range.detach();
        return result;
    }
}

class StringView {
    public timeToImpression: number;
    public timeToLoad: number;
    public timeToEdit: number;
    public timeToCollab: number;
    public viewportCharCount: number;
    public charsPerLine: number;
    public prevTopSegment: SharedString.TextSegment;
    public adjustedTopChar: number;
    public cursorSpan: HTMLSpanElement;
    public viewportDiv: HTMLDivElement;
    public client: SharedString.Client;
    public ticking = false;
    public wheelTicking = false;
    public topChar = 0;
    private off = true;
    private cursorBlinkCount = 0;
    private blinkTimer: any;
    private pendingRender = false;

    constructor(public sharedString: SharedString.SharedString, public totalSegmentCount,
        public totalLengthChars) {
        this.client = sharedString.client;
        this.updateGeometry();

        sharedString.on("op", () => {
            this.queueRender();
        });
    }

    public updateGeometry() {
        this.charsPerLine = window.innerWidth / Math.floor(wEst); // overestimate
        let charsPerViewport = Math.floor((window.innerHeight / hEst) * this.charsPerLine);
        this.viewportCharCount = charsPerViewport;
    }

    public setEdit() {
        document.body.onclick = (e) => {
            let span = <ISegSpan>e.target;
            let segspan: ISegSpan;
            if (span.seg) {
                segspan = span;
            } else {
                segspan = <ISegSpan>span.parentElement;
            }
            if (segspan && segspan.seg) {
                let segOffset = this.client.mergeTree.getOffset(segspan.seg, this.client.getCurrentSeq(),
                    this.client.getClientId());
                let elmOff = pointerToElementOffsetWebkit(e.clientX, e.clientY);
                // tslint:disable:max-line-length
                console.log(`segment ${segspan.childNodes.length} children; at char offset ${segOffset} within: ${elmOff.offset} computed: ${elmOffToSegOff(elmOff, segspan)}`);
            }
        };

        document.body.onmousewheel = (e) => {
            if (!this.wheelTicking) {
                let factor = Math.round(this.viewportCharCount / this.charsPerLine);
                let inputDelta = e.wheelDelta;
                if (Math.abs(e.wheelDelta) === 120) {
                    inputDelta = e.wheelDelta/6;
                }
                let delta = factor * inputDelta;
                console.log(`top char: ${this.topChar - delta} factor ${factor}; delta: ${delta} wheel: ${e.wheelDeltaY} ${e.wheelDelta} ${e.detail}`);
                setTimeout(() => {
                    this.render(Math.floor(this.topChar - delta));
                    this.wheelTicking = false;
                }, 20);
                this.wheelTicking = true;
            }
            e.preventDefault();
            e.returnValue = false;
        };
        window.onresize = () => {
            this.updateGeometry();
            this.render();
        };
        let handler = (e: KeyboardEvent) => {
            console.log(`key ${e.keyCode}`);
            if (((e.keyCode === 33) || (e.keyCode === 34)) && (!this.ticking)) {
                setTimeout(() => {
                    console.log(`animation frame ${Date.now() - clockStart}`);
                    this.scroll(e.keyCode === 33);
                    this.ticking = false;
                }, 20);
                this.ticking = true;
            } else if (e.keyCode === 36) {
                this.render(0);
                e.preventDefault();
                e.returnValue = false;
            } else if (e.keyCode === 35) {
                let halfport = Math.floor(this.viewportCharCount / 2);
                this.render(this.client.getLength() - halfport);
                e.preventDefault();
                e.returnValue = false;
            }
        };
        document.body.onkeydown = handler;
    }

    public scroll(up: boolean) {
        let len = this.client.getLength();
        let halfport = Math.floor(this.viewportCharCount / 2);
        if ((up && (this.topChar === 0)) || ((!up) && (this.topChar > (len - halfport)))) {
            return;
        }
        let scrollTo = this.topChar;
        if (up) {
            scrollTo -= halfport;
        } else {
            scrollTo += halfport;
        }
        this.render(scrollTo);
    }

    public setCursor() {
        if (this.viewportDiv.childElementCount > 0) {
            let firstDiv = this.viewportDiv.children[0];
            let firstSpan = <HTMLSpanElement>firstDiv.children[0];
            firstSpan.style.position = "relative";
            this.cursorSpan = makeCursor();
            this.cursorSpan.style.position = "absolute";
            this.cursorSpan.style.left = "0px";
            this.cursorSpan.style.top = "0px";
            this.cursorSpan.style.width = "1px";
            firstSpan.appendChild(this.cursorSpan);
            clearTimeout(this.blinkTimer);
            this.blinkCursor();
        }
    }

    public render(topChar?: number, changed = false) {
        let len = this.client.getLength();
        let halfport = Math.floor(this.viewportCharCount / 2);
        if (topChar !== undefined) {
            if (((this.topChar === topChar) || ((this.topChar === 0) && (topChar <= 0)))
                && (!changed)) {
                // console.log("no change in top char");
                return;
            }
            this.topChar = topChar;
            if (this.topChar < 0) {
                this.topChar = 0;
            }
            if (this.topChar >= (len - halfport)) {
                this.topChar -= (halfport / 2);
            }
        }
        let clk = Date.now();
        let frac = this.topChar / len;
        let pos = Math.floor(frac * len);
        let oldDiv = document.getElementById("renderedTree");
        if (oldDiv) {
            document.body.removeChild(oldDiv);
        }
        let viewportDiv = document.createElement("div");
        document.body.appendChild(viewportDiv);
        renderTree(viewportDiv, pos, this.client, this);
        let bubbleHeight = Math.max(3, Math.floor((this.viewportCharCount / len) * window.innerHeight));
        let bubbleTop = Math.floor(frac * window.innerHeight);
        let bubbleLeft = window.innerWidth - 18;
        let scrollDiv = makeScrollLosenge(bubbleHeight, bubbleLeft, bubbleTop);
        viewportDiv.appendChild(scrollDiv);
        this.viewportDiv = viewportDiv;
        console.log(`render time: ${Date.now() - clk}ms`);
        // this.setCursor();
    }

    public loadFinished() {
        this.render(0, true);
        // tslint:disable-next-line:max-line-length
        console.log(`time to edit/impression: ${this.timeToEdit} time to load: ${Date.now() - clockStart}ms len: ${this.sharedString.client.getLength()}`);
    }

    private queueRender() {
        if (!this.pendingRender) {
            this.pendingRender = true;
            window.requestAnimationFrame(() => {
                this.pendingRender = false;
                this.render();
            });
        }
    }

    private blinker = () => {
        if (this.off) {
            onCursorStyle(this.cursorSpan);
        } else {
            offCursorStyle(this.cursorSpan);
        }
        this.off = !this.off;
        if (this.cursorBlinkCount > 0) {
            this.cursorBlinkCount--;
            this.blinkTimer = setTimeout(this.blinker, 500);
        } else {
            onCursorStyle(this.cursorSpan);
        }
    }

    private blinkCursor() {
        this.cursorBlinkCount = 30;
        this.off = true;
        this.blinkTimer = setTimeout(this.blinker, 500);
    }

}

export async function onLoad(id: string) {
    const extension = api.defaultRegistry.getExtension(SharedString.CollaboritiveStringExtension.Type);
    const sharedString = extension.load(id, api.getDefaultServices(), api.defaultRegistry) as SharedString.SharedString;

    sharedString.on("partialLoad", async (data: MergeTreeChunk) => {
        console.log("Partial load fired");

        widthEst("18px Times");
        theString = new StringView(sharedString, data.totalSegmentCount, data.totalLengthChars);
        if (data.totalLengthChars > 0) {
            theString.render(0, true);
        }
        theString.timeToEdit = theString.timeToImpression = Date.now() - clockStart;
        theString.setEdit();
    });

    sharedString.on("loadFinshed", (data: MergeTreeChunk) => {
        if (sharedString.client.getLength() !== 0) {
            theString.loadFinished();
        } else {
            console.log("local load...");
            request.get(url.resolve(document.baseURI, "/public/literature/pp.txt"), (error, response, body: string) => {
                if (error) {
                    return console.error(error);
                }
                const segments = SharedString.loadSegments(body, 0);
                for (const segment of segments) {
                    sharedString.insertText((<SharedString.TextSegment>segment).text, sharedString.client.getLength());
                }
                theString.loadFinished();
            });
        }
    });
}
