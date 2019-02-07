import { Cursor } from "./cursor";
import { Scheduler, KeyCode } from "@prague/flow-util";
import { DocumentView, IDocumentProps } from "../document";
import { View, IViewState } from "..";
import { shouldIgnoreEvent } from "../inclusion";

export interface IEditorProps extends IDocumentProps { 
    scheduler: Scheduler;
    eventSink?: HTMLElement;
}

interface ListenerRegistration { 
    target: EventTarget,
    type: string,
    listener: EventListener
}

interface IEditorViewState extends IViewState {
    cursor: Cursor;
    docView: DocumentView;
    eventSink: Element;
    props: IEditorProps;
    listeners: ListenerRegistration[];
}

export class Editor extends View<IEditorProps, IEditorViewState> {
    public invalidate: () => void;

    constructor () {
        super();

        // TODO: Kludge: We temporarily assign invalidate -> render until we get our scheduler in mount().
        this.invalidate = this.render;
    }

    private on<K extends keyof HTMLElementEventMap>(listeners: ListenerRegistration[], target: EventTarget, type: K | string, listener: (ev: HTMLElementEventMap[K]) => any) {
        const wrappedListener = (e: Event) => {
            // Ignore events that bubble up from inclusions
            if (shouldIgnoreEvent(e)) {
                return;
            }

            listener(e);
        }
        
        target.addEventListener(type, wrappedListener);
        listeners.push({ target, type, listener: wrappedListener });
    }

    protected mounting(props: Readonly<IEditorProps>): IEditorViewState {
        const scheduler = props.scheduler;
        this.invalidate = scheduler.coalesce(this.render);
        
        const cursor = new Cursor(props.doc);
        cursor.moveTo(0, false);

        const docView = new DocumentView();
        const root = docView.mount(props);
        docView.overlay.appendChild(cursor.root);

        const listeners: ListenerRegistration[] = [];
        const eventSink = props.eventSink || root;
        this.on(listeners, eventSink, "keydown",   this.onKeyDown);
        this.on(listeners, eventSink, "keypress",  this.onKeyPress);
        this.on(listeners, eventSink, "mousedown", this.onMouseDown);
        this.on(listeners, window,    "resize",    this.invalidate);

        props.doc.on("op", this.invalidate);

        return this.updating(props, {
            root,
            listeners,
            docView,
            eventSink,
            props,
            cursor
        });
    }

    protected updating(props: Readonly<IEditorProps>, state: IEditorViewState): IEditorViewState {
        // If the document has changed, remount the document view.
        if (props.doc !== state.props.doc) {
            this.unmounting(state);
            state = this.mounting(props);
        }

        state.docView.update(props);

        return state;
    }

    protected unmounting(state: IEditorViewState): void {
        for (const listener of state.listeners) {
            listener.target.removeEventListener(listener.type, listener.listener);
        }

        this.doc.off("op", this.invalidate);
    }

    private get cursor()         { return this.state.cursor; }
    public  get doc()            { return this.state.props.doc; }
    private get props()          { return this.state.props; }
    public  get cursorPosition() { return this.state.cursor.position; }

    private readonly render = () => {
        this.props.trackedPositions = this.cursor.getTracked();
        this.state.docView.update(this.props);
        this.cursor.render();
    }

    private delete(deltaStart: number, deltaEnd: number) {
        const start = this.cursor.selectionStart;
        const end = this.cursor.position;

        if (start === end) {
            // If no range is currently selected, delete the preceding character (if any).
            this.doc.remove(start + deltaStart, end + deltaEnd);
        } else {
            // Otherwise, delete the selected range.
            this.doc.remove(Math.min(start, end), Math.max(start, end));
        }
    }

    private insertText(text: string) {
        const start = this.cursor.selectionStart;
        const end = this.cursor.position;
        if (start === end) {
            this.doc.insertText(end, text);
        } else {
            this.doc.replaceWithText(Math.min(start, end), Math.max(start, end), text);
        }
    }

    private readonly onKeyDown = (ev: KeyboardEvent) => {
        const keyCode = ev.keyCode;
        switch (keyCode) {
            // Note: Chrome 69 delivers backspace on 'keydown' only (i.e., 'keypress' is not fired.)
            case KeyCode.Backspace: {
                this.delete(-1, 0);
                ev.stopPropagation();
                break;
            }
            case KeyCode.Delete: {
                this.delete(0, 1);
                ev.stopPropagation();
                break;
            }
            case KeyCode.LeftArrow: {
                this.cursor.moveBy(-1, ev.shiftKey);
                this.invalidate();
                ev.stopPropagation();
                break;
            }
            case KeyCode.RightArrow: {
                this.cursor.moveBy(+1, ev.shiftKey);
                this.invalidate();
                ev.stopPropagation();
                break;
            }
            case KeyCode.DownArrow: {
                const cursorBounds = this.cursor.bounds;
                if (cursorBounds) {
                    const segmentAndOffset = this.state.docView.findBelow(cursorBounds.left, cursorBounds.top, cursorBounds.bottom);
                    if (segmentAndOffset) {
                        const position = this.doc.getPosition(segmentAndOffset.segment!);
                        this.cursor.moveTo(position + segmentAndOffset.offset, ev.shiftKey);
                        this.invalidate();
                        ev.stopPropagation();
                    }
                }
                break;
            }
            default: {
                console.log(`Key: ${ev.key} (${ev.keyCode})`);
                break;
            }
        }
    }

    private readonly onKeyPress = (ev: KeyboardEvent) => {
        switch (ev.keyCode) {
            case KeyCode.Backspace: {
                // Note: Backspace handled on 'keydown' event to support Chrome 69 (see comment in 'onKeyDown').
                break;
            }
            case KeyCode.Enter: {
                if (ev.shiftKey) {
                    this.doc.insertLineBreak(this.cursor.position);
                } else {
                    this.doc.insertParagraph(this.cursor.position);
                }
                ev.stopPropagation();
                break;
            }
            default: {
                this.insertText(ev.key);
                ev.stopPropagation();
                ev.preventDefault();
                break;
            }
        }
    }

    private readonly onMouseDown = (ev: MouseEvent) => {
        const maybeSegmentAndOffset = this.state.docView.hitTest(ev.x, ev.y);
        if (maybeSegmentAndOffset) {
            const { segment, offset } = maybeSegmentAndOffset;
            const position = Math.min(
                this.doc.getPosition(segment) + offset,
                this.doc.length - 1);
            this.cursor.moveTo(position, false);
            this.invalidate();
            ev.stopPropagation();
        }
    }
}