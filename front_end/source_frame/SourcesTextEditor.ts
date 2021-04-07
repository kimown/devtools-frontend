// Copyright (c) 2016 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/* eslint-disable rulesdir/no_underscored_properties */

import * as Common from '../core/common/common.js';
import * as TextEditor from '../text_editor/text_editor.js';
import * as TextUtils from '../text_utils/text_utils.js';
import * as UI from '../ui/legacy/legacy.js';

const whitespaceStyleInjectedSet = new WeakSet<Document>();

export class SourcesTextEditor extends TextEditor.CodeMirrorTextEditor.CodeMirrorTextEditor {
  _delegate: SourcesTextEditorDelegate;
  _gutterMouseMove: (event: Event) => void;
  _gutterMouseOut: () => void;
  _tokenHighlighter: TokenHighlighter;
  _gutters: string[];
  _isHandlingMouseDownEvent: boolean;
  _autocompleteConfig: UI.TextEditor.AutocompleteConfig|null;
  _infoBarDiv: Element|null;
  _selectionBeforeSearch?: TextUtils.TextRange.TextRange;
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _executionLine?: any;
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _executionLineTailMarker?: any;
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _indentationLevel?: any;
  _autoAppendedSpaces?: TextEditor.CodeMirrorTextEditor.TextEditorPositionHandle[];

  constructor(delegate: SourcesTextEditorDelegate, codeMirrorOptions?: UI.TextEditor.Options) {
    const defaultCodeMirrorOptions: UI.TextEditor.Options = {
      lineNumbers: true,
      lineWrapping: false,
      bracketMatchingSetting: Common.Settings.Settings.instance().moduleSetting('textEditorBracketMatching'),
      padBottom: Common.Settings.Settings.instance().moduleSetting('allowScrollPastEof').get(),
      lineWiseCopyCut: true,
      devtoolsAccessibleName: undefined,
      mimeType: undefined,
      autoHeight: undefined,
      maxHighlightLength: undefined,
      placeholder: undefined,
      inputStyle: undefined,
    };
    if (codeMirrorOptions) {
      Object.assign(defaultCodeMirrorOptions, codeMirrorOptions);
    }

    super(defaultCodeMirrorOptions);

    this.codeMirror().addKeyMap({'Enter': 'smartNewlineAndIndent', 'Esc': 'sourcesDismiss'});

    this._delegate = delegate;

    this.codeMirror().on('cursorActivity', this._cursorActivity.bind(this));
    this.codeMirror().on('gutterClick', this._gutterClick.bind(this));
    this.codeMirror().on('scroll', this._scroll.bind(this));
    this.codeMirror().on('focus', this._focus.bind(this));
    this.codeMirror().on('blur', this._blur.bind(this));
    this.codeMirror().on('beforeSelectionChange', this._fireBeforeSelectionChanged.bind(this));
    this.codeMirror().on('gutterContextMenu', this._gutterContextMenu.bind(this));
    this.element.addEventListener('contextmenu', this._textAreaContextMenu.bind(this), false);
    this._gutterMouseMove = (event: Event): void => {
      const mouseEvent = (event as MouseEvent);
      this.element.classList.toggle(
          'CodeMirror-gutter-hovered',
          mouseEvent.clientX < this.codeMirror().getGutterElement().getBoundingClientRect().right);
    };
    this._gutterMouseOut = (): void => {
      this.element.classList.toggle('CodeMirror-gutter-hovered', false);
    };

    this.codeMirror().addKeyMap(_BlockIndentController);
    // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._tokenHighlighter = new TokenHighlighter(this, (this.codeMirror() as any));

    this._gutters = [lineNumbersGutterType];
    this.codeMirror().setOption('gutters', this._gutters.slice());

    this.codeMirror().setOption('electricChars', false);
    this.codeMirror().setOption('smartIndent', false);

    this._isHandlingMouseDownEvent = false;
    function updateAnticipateJumpFlag(this: SourcesTextEditor, value: boolean): void {
      this._isHandlingMouseDownEvent = value;
    }

    this.element.addEventListener('mousedown', updateAnticipateJumpFlag.bind(this, true), true);
    this.element.addEventListener('mousedown', updateAnticipateJumpFlag.bind(this, false), false);
    Common.Settings.Settings.instance()
        .moduleSetting('textEditorIndent')
        .addChangeListener(this._onUpdateEditorIndentation, this);
    Common.Settings.Settings.instance()
        .moduleSetting('textEditorAutoDetectIndent')
        .addChangeListener(this._onUpdateEditorIndentation, this);
    Common.Settings.Settings.instance()
        .moduleSetting('showWhitespacesInEditor')
        .addChangeListener(this._updateWhitespace, this);
    Common.Settings.Settings.instance()
        .moduleSetting('textEditorCodeFolding')
        .addChangeListener(this._updateCodeFolding, this);
    Common.Settings.Settings.instance()
        .moduleSetting('allowScrollPastEof')
        .addChangeListener(this._updateScrollPastEof, this);
    this._updateCodeFolding();

    this._autocompleteConfig = {
      isWordChar: TextUtils.TextUtils.Utils.isWordChar,
      substituteRangeCallback: undefined,
      tooltipCallback: undefined,
      suggestionsCallback: undefined,
      anchorBehavior: undefined,
    };
    Common.Settings.Settings.instance()
        .moduleSetting('textEditorAutocompletion')
        .addChangeListener(this._updateAutocomplete, this);
    this._updateAutocomplete();

    this._onUpdateEditorIndentation();
    this._setupWhitespaceHighlight();

    this._infoBarDiv = null;
  }

  // https://crbug.com/1151919 * = CodeMirror.Editor
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static getForCodeMirror(codeMirrorEditor: any): SourcesTextEditor {
    return TextEditor.CodeMirrorTextEditor.CodeMirrorTextEditor.getForCodeMirror(codeMirrorEditor) as SourcesTextEditor;
  }

  attachInfobar(infobar: UI.Infobar.Infobar): void {
    if (!this._infoBarDiv) {
      this._infoBarDiv = document.createElement('div');
      this._infoBarDiv.classList.add('flex-none');
      this.element.insertBefore(this._infoBarDiv, this.element.firstChild);
    }
    this._infoBarDiv.appendChild(infobar.element);
    infobar.setParentView(this);
    this.doResize();
  }

  static _guessIndentationLevel(lines: string[]): string {
    const tabRegex = /^\t+/;
    let tabLines = 0;
    /**
     * Maps the indentation level to its frequency in |lines|.
     */
    const indents = new Map<number, number>();
    for (let lineNumber = 0; lineNumber < lines.length; ++lineNumber) {
      const text = lines[lineNumber];
      if (text.length === 0 || !TextUtils.TextUtils.Utils.isSpaceChar(text[0])) {
        continue;
      }
      if (tabRegex.test(text)) {
        ++tabLines;
        continue;
      }
      let i = 0;
      while (i < text.length && TextUtils.TextUtils.Utils.isSpaceChar(text[i])) {
        ++i;
      }
      if (i % 2 !== 0) {
        continue;
      }
      indents.set(i, 1 + (indents.get(i) || 0));
    }
    const linesCountPerIndentThreshold = 3 * lines.length / 100;
    if (tabLines && tabLines > linesCountPerIndentThreshold) {
      return '\t';
    }
    let minimumIndent: number = Infinity;
    for (const [indent, frequency] of indents) {
      if (frequency < linesCountPerIndentThreshold) {
        continue;
      }
      if (minimumIndent > indent) {
        minimumIndent = indent;
      }
    }
    if (minimumIndent === Infinity) {
      return Common.Settings.Settings.instance().moduleSetting('textEditorIndent').get();
    }
    return ' '.repeat(minimumIndent);
  }

  _isSearchActive(): boolean {
    return Boolean(this._tokenHighlighter.highlightedRegex());
  }

  scrollToLine(lineNumber: number): void {
    super.scrollToLine(lineNumber);
    this._scroll();
  }

  highlightSearchResults(regex: RegExp, range: TextUtils.TextRange.TextRange|null): void {
    function innerHighlightRegex(this: SourcesTextEditor): void {
      if (range) {
        this.scrollLineIntoView(range.startLine);
        if (range.endColumn > TextEditor.CodeMirrorTextEditor.CodeMirrorTextEditor.maxHighlightLength) {
          this.setSelection(range);
        } else {
          this.setSelection(TextUtils.TextRange.TextRange.createFromLocation(range.startLine, range.startColumn));
        }
      }
      this._tokenHighlighter.highlightSearchResults(regex, range);
    }

    if (!this._selectionBeforeSearch) {
      this._selectionBeforeSearch = this.selection();
    }

    this.codeMirror().operation(innerHighlightRegex.bind(this));
  }

  cancelSearchResultsHighlight(): void {
    this.codeMirror().operation(this._tokenHighlighter.highlightSelectedTokens.bind(this._tokenHighlighter));

    if (this._selectionBeforeSearch) {
      this._reportJump(this._selectionBeforeSearch, this.selection());
      delete this._selectionBeforeSearch;
    }
  }

  // https://crbug.com/1151919 * = CodeMirror.TextMarker
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeHighlight(highlightDescriptor: any): void {
    highlightDescriptor.clear();
  }

  // https://crbug.com/1151919 * = CodeMirror.TextMarker<CodeMirror.MarkerRange>
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  highlightRange(range: TextUtils.TextRange.TextRange, cssClass: string): any {
    cssClass = 'CodeMirror-persist-highlight ' + cssClass;
    const pos = TextUtils.CodeMirrorUtils.toPos(range);
    ++pos.end.ch;
    return this.codeMirror().markText(
        pos.start, pos.end, {className: cssClass, startStyle: cssClass + '-start', endStyle: cssClass + '-end'});
  }

  installGutter(type: string, leftToNumbers: boolean): void {
    if (this._gutters.indexOf(type) !== -1) {
      return;
    }

    if (leftToNumbers) {
      this._gutters.unshift(type);
    } else {
      this._gutters.push(type);
    }

    this.codeMirror().setOption('gutters', this._gutters.slice());
    this.refresh();
  }

  uninstallGutter(type: string): void {
    const index = this._gutters.indexOf(type);
    if (index === -1) {
      return;
    }
    this.codeMirror().clearGutter(type);
    this._gutters.splice(index, 1);
    this.codeMirror().setOption('gutters', this._gutters.slice());
    this.refresh();
  }

  setGutterDecoration(lineNumber: number, type: string, element: Element|null): void {
    console.assert(this._gutters.indexOf(type) !== -1, 'Cannot decorate unexisting gutter.');
    this.codeMirror().setGutterMarker(lineNumber, type, element);
  }

  setExecutionLocation(lineNumber: number, columnNumber: number): void {
    this.clearPositionHighlight();

    this._executionLine = this.codeMirror().getLineHandle(lineNumber);
    if (!this._executionLine) {
      return;
    }

    this.showExecutionLineBackground();
    this.codeMirror().addLineClass(this._executionLine, 'wrap', 'cm-execution-line-outline');
    let token = this.tokenAtTextPosition(lineNumber, columnNumber);

    if (token && !token.type && token.startColumn + 1 === token.endColumn) {
      const tokenContent = this.codeMirror().getLine(lineNumber)[token.startColumn];
      if (tokenContent === '.' || tokenContent === '(') {
        token = this.tokenAtTextPosition(lineNumber, token.endColumn + 1);
      }
    }

    let endColumn;
    if (token && token.type) {
      endColumn = token.endColumn;
    } else {
      endColumn = this.codeMirror().getLine(lineNumber).length;
    }

    this._executionLineTailMarker = this.codeMirror().markText(
        {line: lineNumber, ch: columnNumber}, {line: lineNumber, ch: endColumn}, {className: 'cm-execution-line-tail'});
  }

  showExecutionLineBackground(): void {
    if (this._executionLine) {
      this.codeMirror().addLineClass(this._executionLine, 'wrap', 'cm-execution-line');
    }
  }

  hideExecutionLineBackground(): void {
    if (this._executionLine) {
      this.codeMirror().removeLineClass(this._executionLine, 'wrap', 'cm-execution-line');
    }
  }

  clearExecutionLine(): void {
    this.clearPositionHighlight();

    if (this._executionLine) {
      this.hideExecutionLineBackground();
      this.codeMirror().removeLineClass(this._executionLine, 'wrap', 'cm-execution-line-outline');
    }
    delete this._executionLine;

    if (this._executionLineTailMarker) {
      this._executionLineTailMarker.clear();
    }
    delete this._executionLineTailMarker;
  }

  toggleLineClass(lineNumber: number, className: string, toggled: boolean): void {
    if (this.hasLineClass(lineNumber, className) === toggled) {
      return;
    }

    const lineHandle = this.codeMirror().getLineHandle(lineNumber);
    if (!lineHandle) {
      return;
    }

    if (toggled) {
      this.codeMirror().addLineClass(lineHandle, 'gutter', className);
      this.codeMirror().addLineClass(lineHandle, 'wrap', className);
    } else {
      this.codeMirror().removeLineClass(lineHandle, 'gutter', className);
      this.codeMirror().removeLineClass(lineHandle, 'wrap', className);
    }
  }

  hasLineClass(lineNumber: number, className: string): boolean {
    const lineInfo = this.codeMirror().lineInfo(lineNumber);
    if (!lineInfo) {
      return false;
    }
    const wrapClass = lineInfo.wrapClass;
    if (!wrapClass) {
      return false;
    }
    const classNames = wrapClass.split(' ');
    return classNames.indexOf(className) !== -1;
  }

  /**
   * |instance| is actually a CodeMirror.Editor
   */
  _gutterClick(_instance: Object, lineNumber: number, gutterType: string, event: MouseEvent): void {
    this.dispatchEventToListeners(Events.GutterClick, {gutterType, lineNumber, event});
  }

  _textAreaContextMenu(event: MouseEvent): void {
    const contextMenu = new UI.ContextMenu.ContextMenu(event);
    event.consume(true);  // Consume event now to prevent document from handling the async menu

    const textSelection = this.selection();
    this._delegate.populateTextAreaContextMenu(contextMenu, textSelection.startLine, textSelection.startColumn)
        .then(() => {
          contextMenu.appendApplicableItems(this);
          contextMenu.show();
        });
  }

  /**
   * |instance| is actually a CodeMirror.Editor
   */
  _gutterContextMenu(_instance: Object, lineNumber: number, _gutterType: string, event: MouseEvent): void {
    const contextMenu = new UI.ContextMenu.ContextMenu(event);
    event.consume(true);  // Consume event now to prevent document from handling the async menu

    this._delegate.populateLineGutterContextMenu(contextMenu, lineNumber).then(() => {
      contextMenu.appendApplicableItems(this);
      contextMenu.show();
    });
  }

  editRange(range: TextUtils.TextRange.TextRange, text: string, origin?: string): TextUtils.TextRange.TextRange {
    const newRange = super.editRange(range, text, origin);
    if (Common.Settings.Settings.instance().moduleSetting('textEditorAutoDetectIndent').get()) {
      this._onUpdateEditorIndentation();
    }

    return newRange;
  }

  _onUpdateEditorIndentation(): void {
    this._setEditorIndentation(
        TextUtils.CodeMirrorUtils.pullLines(this.codeMirror(), LinesToScanForIndentationGuessing));
  }

  _setEditorIndentation(lines: string[]): void {
    const extraKeys = {};
    let indent = Common.Settings.Settings.instance().moduleSetting('textEditorIndent').get();
    if (Common.Settings.Settings.instance().moduleSetting('textEditorAutoDetectIndent').get()) {
      indent = SourcesTextEditor._guessIndentationLevel(lines);
    }

    if (indent === '\t') {
      this.codeMirror().setOption('indentWithTabs', true);
      this.codeMirror().setOption('indentUnit', 4);
    } else {
      this.codeMirror().setOption('indentWithTabs', false);
      this.codeMirror().setOption('indentUnit', indent.length);
      /**
       * TODO: |codeMirror| is really a CodeMirror.Editor
       */
      // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function tab(codeMirror: any): any {
        if (codeMirror.somethingSelected()) {
          return CodeMirror.Pass;
        }
        const pos = codeMirror.getCursor('head');
        codeMirror.replaceRange(indent.substring(pos.ch % indent.length), codeMirror.getCursor());
      }

      // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
      // @ts-expect-error
      extraKeys.Tab = tab;
    }

    this.codeMirror().setOption('extraKeys', extraKeys);
    this._indentationLevel = indent;
  }

  indent(): string {
    return this._indentationLevel;
  }

  _onAutoAppendedSpaces(): void {
    this._autoAppendedSpaces = this._autoAppendedSpaces || [];

    for (let i = 0; i < this._autoAppendedSpaces.length; ++i) {
      const position = this._autoAppendedSpaces[i].resolve();
      if (!position) {
        continue;
      }
      const line = this.line(position.lineNumber);
      if (line.length === position.columnNumber && TextUtils.TextUtils.Utils.lineIndent(line).length === line.length) {
        this.codeMirror().replaceRange(
            '', new CodeMirror.Pos(position.lineNumber, 0),
            new CodeMirror.Pos(position.lineNumber, position.columnNumber));
      }
    }

    this._autoAppendedSpaces = [];
    const selections = this.selections();
    for (let i = 0; i < selections.length; ++i) {
      const selection = selections[i];
      this._autoAppendedSpaces.push(this.textEditorPositionHandle(selection.startLine, selection.startColumn));
    }
  }

  _cursorActivity(): void {
    if (!this._isSearchActive()) {
      this.codeMirror().operation(this._tokenHighlighter.highlightSelectedTokens.bind(this._tokenHighlighter));
    }

    const start = this.codeMirror().getCursor('anchor');
    const end = this.codeMirror().getCursor('head');
    this.dispatchEventToListeners(Events.SelectionChanged, TextUtils.CodeMirrorUtils.toRange(start, end));
  }

  _reportJump(from: TextUtils.TextRange.TextRange|null, to: TextUtils.TextRange.TextRange|null): void {
    if (from && to && from.equal(to)) {
      return;
    }
    this.dispatchEventToListeners(Events.JumpHappened, {from: from, to: to});
  }

  _scroll(): void {
    const topmostLineNumber = this.codeMirror().lineAtHeight(this.codeMirror().getScrollInfo().top, 'local');
    this.dispatchEventToListeners(Events.ScrollChanged, topmostLineNumber);
  }

  _focus(): void {
    this.dispatchEventToListeners(Events.EditorFocused);
  }

  _blur(): void {
    this.dispatchEventToListeners(Events.EditorBlurred);
  }

  // https://crbug.com/1151919 * = {ranges: !Array.<{head: !CodeMirror.Pos, anchor: !CodeMirror.Pos}>}
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _fireBeforeSelectionChanged(_codeMirror: typeof CodeMirror, selection: any): void {
    if (!this._isHandlingMouseDownEvent) {
      return;
    }
    if (!selection.ranges.length) {
      return;
    }

    const primarySelection = selection.ranges[0];
    this._reportJump(
        this.selection(), TextUtils.CodeMirrorUtils.toRange(primarySelection.anchor, primarySelection.head));
  }

  dispose(): void {
    super.dispose();
    Common.Settings.Settings.instance()
        .moduleSetting('textEditorIndent')
        .removeChangeListener(this._onUpdateEditorIndentation, this);
    Common.Settings.Settings.instance()
        .moduleSetting('textEditorAutoDetectIndent')
        .removeChangeListener(this._onUpdateEditorIndentation, this);
    Common.Settings.Settings.instance()
        .moduleSetting('showWhitespacesInEditor')
        .removeChangeListener(this._updateWhitespace, this);
    Common.Settings.Settings.instance()
        .moduleSetting('textEditorCodeFolding')
        .removeChangeListener(this._updateCodeFolding, this);
    Common.Settings.Settings.instance()
        .moduleSetting('allowScrollPastEof')
        .removeChangeListener(this._updateScrollPastEof, this);
  }

  setText(text: string): void {
    this._setEditorIndentation(text.split('\n').slice(0, LinesToScanForIndentationGuessing));
    super.setText(text);
  }

  _updateWhitespace(): void {
    this.setMimeType(this.mimeType());
  }

  _updateCodeFolding(): void {
    if (Common.Settings.Settings.instance().moduleSetting('textEditorCodeFolding').get()) {
      this.installGutter('CodeMirror-foldgutter', false);
      this.element.addEventListener('mousemove', this._gutterMouseMove);
      this.element.addEventListener('mouseout', this._gutterMouseOut);
      this.codeMirror().setOption('foldGutter', true);
      this.codeMirror().setOption('foldOptions', {minFoldSize: 1});
    } else {
      this.codeMirror().execCommand('unfoldAll');
      this.element.removeEventListener('mousemove', this._gutterMouseMove);
      this.element.removeEventListener('mouseout', this._gutterMouseOut);
      this.uninstallGutter('CodeMirror-foldgutter');
      this.codeMirror().setOption('foldGutter', false);
    }
  }

  _updateScrollPastEof(): void {
    this.toggleScrollPastEof(Common.Settings.Settings.instance().moduleSetting('allowScrollPastEof').get());
  }

  rewriteMimeType(mimeType: string): string {
    this._setupWhitespaceHighlight();
    const whitespaceMode = Common.Settings.Settings.instance().moduleSetting('showWhitespacesInEditor').get();
    this.element.classList.toggle('show-whitespaces', whitespaceMode === 'all');

    if (whitespaceMode === 'all') {
      return this._allWhitespaceOverlayMode(mimeType);
    }
    if (whitespaceMode === 'trailing') {
      return this._trailingWhitespaceOverlayMode(mimeType);
    }

    return mimeType;
  }

  _allWhitespaceOverlayMode(mimeType: string): string {
    let modeName = CodeMirror.mimeModes[mimeType] ?
        (CodeMirror.mimeModes[mimeType].name || CodeMirror.mimeModes[mimeType]) :
        CodeMirror.mimeModes['text/plain'];
    modeName += '+all-whitespaces';
    if (CodeMirror.modes[modeName]) {
      return modeName;
    }

    /**
     * TODO: |config| is really a CodeMirror.EditorConfiguration
     */
    // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function modeConstructor(config: Object, _parserConfig: any): CodeMirror.Mode<any> {
      // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function nextToken(stream: any): string|null {
        if (stream.peek() === ' ') {
          let spaces = 0;
          while (spaces < MaximumNumberOfWhitespacesPerSingleSpan && stream.peek() === ' ') {
            ++spaces;
            stream.next();
          }
          return 'whitespace whitespace-' + spaces;
        }
        while (!stream.eol() && stream.peek() !== ' ') {
          stream.next();
        }
        return null;
      }
      const whitespaceMode = {token: nextToken};
      return CodeMirror.overlayMode(CodeMirror.getMode(config, mimeType), whitespaceMode, false);
    }
    CodeMirror.defineMode(modeName, modeConstructor);
    return modeName;
  }

  _trailingWhitespaceOverlayMode(mimeType: string): string {
    let modeName = CodeMirror.mimeModes[mimeType] ?
        (CodeMirror.mimeModes[mimeType].name || CodeMirror.mimeModes[mimeType]) :
        CodeMirror.mimeModes['text/plain'];
    modeName += '+trailing-whitespaces';
    if (CodeMirror.modes[modeName]) {
      return modeName;
    }

    /**
     * TODO: |config| is really a CodeMirror.EditorConfiguration
     */
    // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function modeConstructor(config: Object, _parserConfig: any): CodeMirror.Mode<any> {
      // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function nextToken(stream: any): 'trailing-whitespace'|null {
        if (stream.match(/^\s+$/, true)) {
          return true ? 'trailing-whitespace' : null;
        }
        do {
          stream.next();
        } while (!stream.eol() && stream.peek() !== ' ');
        return null;
      }
      const whitespaceMode = {token: nextToken};
      return CodeMirror.overlayMode(CodeMirror.getMode(config, mimeType), whitespaceMode, false);
    }
    CodeMirror.defineMode(modeName, modeConstructor);
    return modeName;
  }

  _setupWhitespaceHighlight(): void {
    const doc = (this.element.ownerDocument as Document);
    if (whitespaceStyleInjectedSet.has(doc) ||
        !Common.Settings.Settings.instance().moduleSetting('showWhitespacesInEditor').get()) {
      return;
    }
    whitespaceStyleInjectedSet.add(doc);
    const classBase = '.show-whitespaces .CodeMirror .cm-whitespace-';
    const spaceChar = '·';
    let spaceChars = '';
    let rules = '';
    for (let i = 1; i <= MaximumNumberOfWhitespacesPerSingleSpan; ++i) {
      spaceChars += spaceChar;
      const rule = classBase + i + '::before { content: \'' + spaceChars + '\';}\n';
      rules += rule;
    }
    const style = doc.createElement('style');
    style.textContent = rules;
    doc.head.appendChild(style);
  }

  configureAutocomplete(config: UI.TextEditor.AutocompleteConfig|null): void {
    this._autocompleteConfig = config;
    this._updateAutocomplete();
  }

  _updateAutocomplete(): void {
    super.configureAutocomplete(
        Common.Settings.Settings.instance().moduleSetting('textEditorAutocompletion').get() ? this._autocompleteConfig :
                                                                                              null);
  }
}

// TODO(crbug.com/1167717): Make this a const enum again
// eslint-disable-next-line rulesdir/const_enum
export enum Events {
  GutterClick = 'GutterClick',
  SelectionChanged = 'SelectionChanged',
  ScrollChanged = 'ScrollChanged',
  EditorFocused = 'EditorFocused',
  EditorBlurred = 'EditorBlurred',
  JumpHappened = 'JumpHappened',
}

export class SourcesTextEditorDelegate {
  populateLineGutterContextMenu(_contextMenu: UI.ContextMenu.ContextMenu, _lineNumber: number): Promise<void> {
    throw new Error('Not implemented');
  }
  populateTextAreaContextMenu(_contextMenu: UI.ContextMenu.ContextMenu, _lineNumber: number, _columnNumber: number):
      Promise<void> {
    throw new Error('Not implemented');
  }
}

// https://crbug.com/1151919 * = !CodeMirror.Editor
// @ts-ignore https://crbug.com/1151919 CodeMirror types are incorrect
// TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
CodeMirror.commands.smartNewlineAndIndent = function(codeMirror: any): void {
  codeMirror.operation(innerSmartNewlineAndIndent.bind(null, codeMirror));
  // https://crbug.com/1151919 * = !CodeMirror.Editor
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function innerSmartNewlineAndIndent(codeMirror: any): void {
    const selections = codeMirror.listSelections();
    const replacements = [];
    for (let i = 0; i < selections.length; ++i) {
      const selection = selections[i];
      const cur = CodeMirror.cmpPos(selection.head, selection.anchor) < 0 ? selection.head : selection.anchor;
      const line = codeMirror.getLine(cur.line);
      const indent = TextUtils.TextUtils.Utils.lineIndent(line);
      replacements.push('\n' + indent.substring(0, Math.min(cur.ch, indent.length)));
    }
    // @ts-ignore replaceSelection has not been added to the types yet.
    codeMirror.replaceSelections(replacements);
    SourcesTextEditor.getForCodeMirror(codeMirror)._onAutoAppendedSpaces();
  }
};

// https://crbug.com/1151919 * = !CodeMirror.Editor
// @ts-ignore https://crbug.com/1151919 CodeMirror types are incorrect
// TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
CodeMirror.commands.sourcesDismiss = function(codeMirror: any): Object|undefined {
  if (codeMirror.listSelections().length === 1 && SourcesTextEditor.getForCodeMirror(codeMirror)._isSearchActive()) {
    return CodeMirror.Pass;
  }
  // @ts-ignore https://crbug.com/1151919 CodeMirror types are incorrect
  return CodeMirror.commands.dismiss(codeMirror);
};

// TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
// eslint-disable-next-line @typescript-eslint/naming-convention
export const _BlockIndentController = {
  name: 'blockIndentKeymap',

  // https://crbug.com/1151919 * = !CodeMirror.Editor
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Enter: function(codeMirror: any): any {
    let selections = codeMirror.listSelections();
    const replacements = [];
    let allSelectionsAreCollapsedBlocks = false;
    for (let i = 0; i < selections.length; ++i) {
      const selection = selections[i];
      const start = CodeMirror.cmpPos(selection.head, selection.anchor) < 0 ? selection.head : selection.anchor;
      const line = codeMirror.getLine(start.line);
      const indent = TextUtils.TextUtils.Utils.lineIndent(line);
      let indentToInsert = '\n' + indent + SourcesTextEditor.getForCodeMirror(codeMirror).indent();
      let isCollapsedBlock = false;
      if (selection.head.ch === 0) {
        return CodeMirror.Pass;
      }
      if (line.substr(selection.head.ch - 1, 2) === '{}') {
        indentToInsert += '\n' + indent;
        isCollapsedBlock = true;
      } else if (line.substr(selection.head.ch - 1, 1) !== '{') {
        return CodeMirror.Pass;
      }
      if (i > 0 && allSelectionsAreCollapsedBlocks !== isCollapsedBlock) {
        return CodeMirror.Pass;
      }
      replacements.push(indentToInsert);
      allSelectionsAreCollapsedBlocks = isCollapsedBlock;
    }
    codeMirror.replaceSelections(replacements);
    if (!allSelectionsAreCollapsedBlocks) {
      SourcesTextEditor.getForCodeMirror(codeMirror)._onAutoAppendedSpaces();
      return;
    }
    selections = codeMirror.listSelections();
    const updatedSelections = [];
    for (let i = 0; i < selections.length; ++i) {
      const selection = selections[i];
      const line = codeMirror.getLine(selection.head.line - 1);
      const position = new CodeMirror.Pos(selection.head.line - 1, line.length);
      updatedSelections.push({head: position, anchor: position});
    }
    codeMirror.setSelections(updatedSelections);
    SourcesTextEditor.getForCodeMirror(codeMirror)._onAutoAppendedSpaces();
  },

  // https://crbug.com/1151919 * = !CodeMirror.Editor
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  '\'}\'': function(codeMirror: any): any {
    if (codeMirror.somethingSelected()) {
      return CodeMirror.Pass;
    }
    let selections = codeMirror.listSelections();
    let replacements: string[] = [];
    for (let i = 0; i < selections.length; ++i) {
      const selection = selections[i];
      const line = codeMirror.getLine(selection.head.line);
      if (line !== TextUtils.TextUtils.Utils.lineIndent(line)) {
        return CodeMirror.Pass;
      }
      replacements.push('}');
    }
    codeMirror.replaceSelections(replacements);
    selections = codeMirror.listSelections();
    replacements = [];
    const updatedSelections = [];
    for (let i = 0; i < selections.length; ++i) {
      const selection = selections[i];
      const matchingBracket = codeMirror.findMatchingBracket(selection.head);
      if (!matchingBracket || !matchingBracket.match) {
        return;
      }
      updatedSelections.push({head: selection.head, anchor: new CodeMirror.Pos(selection.head.line, 0)});
      const line = codeMirror.getLine(matchingBracket.to.line);
      const indent = TextUtils.TextUtils.Utils.lineIndent(line);
      replacements.push(indent + '}');
    }
    codeMirror.setSelections(updatedSelections);
    codeMirror.replaceSelections(replacements);
  },
};

export class TokenHighlighter {
  _textEditor: SourcesTextEditor;
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _codeMirror: any;
  _highlightDescriptor!: {
    overlay: {
      // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      token: (arg0: any) => string | null,
    },
    // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    selectionStart: any,
  }|undefined;
  _highlightRegex?: RegExp;
  _highlightRange?: TextUtils.TextRange.TextRange|null;
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _searchResultMarker?: any;
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _searchMatchLength?: any;
  // https://crbug.com/1151919 * = !CodeMirror.Editor
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(textEditor: SourcesTextEditor, codeMirror: any) {
    this._textEditor = textEditor;
    this._codeMirror = codeMirror;
  }

  highlightSearchResults(regex: RegExp, range: TextUtils.TextRange.TextRange|null): void {
    const oldRegex = this._highlightRegex;
    this._highlightRegex = regex;
    this._highlightRange = range;
    if (this._searchResultMarker) {
      this._searchResultMarker.clear();
      delete this._searchResultMarker;
    }
    if (this._highlightDescriptor && this._highlightDescriptor.selectionStart) {
      this._codeMirror.removeLineClass(this._highlightDescriptor.selectionStart.line, 'wrap', 'cm-line-with-selection');
    }
    const selectionStart = this._highlightRange ?
        new CodeMirror.Pos(this._highlightRange.startLine, this._highlightRange.startColumn) :
        null;
    if (selectionStart) {
      this._codeMirror.addLineClass(selectionStart.line, 'wrap', 'cm-line-with-selection');
    }
    if (oldRegex && this._highlightRegex.toString() === oldRegex.toString()) {
      // Do not re-add overlay mode if regex did not change for better performance.
      if (this._highlightDescriptor) {
        this._highlightDescriptor.selectionStart = selectionStart;
      }
    } else {
      this._removeHighlight();
      this._setHighlighter(this._searchHighlighter.bind(this, this._highlightRegex), selectionStart);
    }
    if (this._highlightRange) {
      const pos = TextUtils.CodeMirrorUtils.toPos(this._highlightRange);
      this._searchResultMarker = this._codeMirror.markText(pos.start, pos.end, {className: 'cm-column-with-selection'});
    }
  }

  highlightedRegex(): RegExp|undefined {
    return this._highlightRegex;
  }

  highlightSelectedTokens(): void {
    delete this._highlightRegex;
    delete this._highlightRange;
    if (this._highlightDescriptor && this._highlightDescriptor.selectionStart) {
      this._codeMirror.removeLineClass(this._highlightDescriptor.selectionStart.line, 'wrap', 'cm-line-with-selection');
    }
    this._removeHighlight();
    const selectionStart = this._codeMirror.getCursor('start');
    const selectionEnd = this._codeMirror.getCursor('end');
    if (selectionStart.line !== selectionEnd.line) {
      return;
    }
    if (selectionStart.ch === selectionEnd.ch) {
      return;
    }
    const selections = this._codeMirror.getSelections();
    if (selections.length > 1) {
      return;
    }
    const selectedText = selections[0];
    if (this._isWord(selectedText, selectionStart.line, selectionStart.ch, selectionEnd.ch)) {
      if (selectionStart) {
        this._codeMirror.addLineClass(selectionStart.line, 'wrap', 'cm-line-with-selection');
      }
      this._setHighlighter(this._tokenHighlighter.bind(this, selectedText, selectionStart), selectionStart);
    }
  }

  _isWord(selectedText: string, lineNumber: number, startColumn: number, endColumn: number): boolean {
    const line = this._codeMirror.getLine(lineNumber);
    const leftBound = startColumn === 0 || !TextUtils.TextUtils.Utils.isWordChar(line.charAt(startColumn - 1));
    const rightBound = endColumn === line.length || !TextUtils.TextUtils.Utils.isWordChar(line.charAt(endColumn));
    return leftBound && rightBound && TextUtils.TextUtils.Utils.isWord(selectedText);
  }

  _removeHighlight(): void {
    if (this._highlightDescriptor) {
      this._codeMirror.removeOverlay(this._highlightDescriptor.overlay);
      delete this._highlightDescriptor;
    }
  }

  // https://crbug.com/1151919 * = !CodeMirror.StringStream
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _searchHighlighter(regex: RegExp, stream: any): string|null {
    if (stream.column() === 0) {
      delete this._searchMatchLength;
    }
    if (this._searchMatchLength) {
      if (this._searchMatchLength > 2) {
        for (let i = 0; i < this._searchMatchLength - 2; ++i) {
          stream.next();
        }
        this._searchMatchLength = 1;
        return 'search-highlight';
      }
      stream.next();
      delete this._searchMatchLength;
      return 'search-highlight search-highlight-end';
    }
    const match = stream.string.slice(stream.pos).match(regex);
    if (match) {
      if (match.index === 0) {
        stream.next();
        const matchLength = match[0].length;
        if (matchLength === 1) {
          return 'search-highlight search-highlight-full';
        }
        this._searchMatchLength = matchLength;
        return 'search-highlight search-highlight-start';
      }
      stream.pos += (match.index as number);
    } else {
      stream.skipToEnd();
    }
    return null;
  }

  // https://crbug.com/1151919 * = !CodeMirror.Position selectionStart
  // https://crbug.com/1151919 * = !CodeMirror.StringStream stream
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _tokenHighlighter(token: string, selectionStart: any, stream: any): string|null {
    const tokenFirstChar = token.charAt(0);
    if (stream.match(token) && (stream.eol() || !TextUtils.TextUtils.Utils.isWordChar((stream.peek() as string)))) {
      return stream.column() === selectionStart.ch ? 'token-highlight column-with-selection' : 'token-highlight';
    }
    let eatenChar;
    do {
      eatenChar = stream.next();
    } while (eatenChar && (TextUtils.TextUtils.Utils.isWordChar(eatenChar) || stream.peek() !== tokenFirstChar));
    return null;
  }

  // https://crbug.com/1151919 * = !CodeMirror.StringStream
  // https://crbug.com/1151919 * = ?CodeMirror.Position
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _setHighlighter(highlighter: (arg0: any) => string | null, selectionStart: any): void {
    const overlayMode = {token: highlighter};
    this._codeMirror.addOverlay(overlayMode);
    this._highlightDescriptor = {overlay: overlayMode, selectionStart: selectionStart};
  }
}

const LinesToScanForIndentationGuessing = 1000;
const MaximumNumberOfWhitespacesPerSingleSpan = 16;
export const lineNumbersGutterType = 'CodeMirror-linenumbers';

export interface GutterClickEventData {
  gutterType: string;
  lineNumber: number;
  event: MouseEvent;
}
