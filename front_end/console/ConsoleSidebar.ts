// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/* eslint-disable rulesdir/no_underscored_properties */

import * as Common from '../common/common.js';
import * as i18n from '../i18n/i18n.js';
import * as SDK from '../sdk/sdk.js';
import type * as TextUtils from '../text_utils/text_utils.js';
import * as UI from '../ui/ui.js';

import {ConsoleFilter, FilterType, LevelsMask} from './ConsoleFilter.js';
import type {ConsoleViewMessage} from './ConsoleViewMessage.js';

const UIStrings = {
  /**
  * @description Filter name in Console Sidebar of the Console panel. This is shown when we fail to
  * parse a URL when trying to display console messages from each URL separately. This might be
  * because the console message does not come from any particular URL. This should be translated as
  * a term that indicates 'not one of the other URLs listed here'.
  */
  other: '<other>',
  /**
  *@description Text in Console Sidebar of the Console panel to show how many user messages exist.
  */
  dUserMessages: '{n, plural, =0 {No user messages} =1 {# user message} other {# user messages}}',
  /**
  *@description Text in Console Sidebar of the Console panel to show how many messages exist.
  */
  dMessages: '{n, plural, =0 {No messages} =1 {# message} other {# messages}}',
  /**
  *@description Text in Console Sidebar of the Console panel to show how many errors exist.
  */
  dErrors: '{n, plural, =0 {No errors} =1 {# error} other {# errors}}',
  /**
  *@description Text in Console Sidebar of the Console panel to show how many warnings exist.
  */
  dWarnings: '{n, plural, =0 {No warnings} =1 {# warning} other {# warnings}}',
  /**
  *@description Text in Console Sidebar of the Console panel to show how many info messages exist.
  */
  dInfo: '{n, plural, =0 {No info} =1 {# info} other {# info}}',
  /**
  *@description Text in Console Sidebar of the Console panel to show how many verbose messages exist.
  */
  dVerbose: '{n, plural, =0 {No verbose} =1 {# verbose} other {# verbose}}',
};
const str_ = i18n.i18n.registerUIStrings('console/ConsoleSidebar.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);

export class ConsoleSidebar extends UI.Widget.VBox {
  _tree: UI.TreeOutline.TreeOutlineInShadow;
  _selectedTreeElement: UI.TreeOutline.TreeElement|null;
  _treeElements: FilterTreeElement[];

  constructor() {
    super(true);
    this.setMinimumSize(125, 0);

    this._tree = new UI.TreeOutline.TreeOutlineInShadow();
    this._tree.registerRequiredCSS('console/consoleSidebar.css', {enableLegacyPatching: true});
    this._tree.addEventListener(UI.TreeOutline.Events.ElementSelected, this._selectionChanged.bind(this));
    this.contentElement.appendChild(this._tree.element);
    this._selectedTreeElement = null;
    this._treeElements = [];
    const selectedFilterSetting: Common.Settings.Setting<string> =
        Common.Settings.Settings.instance().createSetting('console.sidebarSelectedFilter', null);

    const Levels = SDK.ConsoleModel.MessageLevel;
    const consoleAPIParsedFilters =
        [{key: FilterType.Source, text: SDK.ConsoleModel.MessageSource.ConsoleAPI, negative: false, regex: undefined}];
    this._appendGroup(
        GroupName.All, [], ConsoleFilter.allLevelsFilterValue(), UI.Icon.Icon.create('mediumicon-list'),
        selectedFilterSetting);
    this._appendGroup(
        GroupName.ConsoleAPI, consoleAPIParsedFilters, ConsoleFilter.allLevelsFilterValue(),
        UI.Icon.Icon.create('mediumicon-account-circle'), selectedFilterSetting);
    this._appendGroup(
        GroupName.Error, [], ConsoleFilter.singleLevelMask(Levels.Error),
        UI.Icon.Icon.create('mediumicon-error-circle'), selectedFilterSetting);
    this._appendGroup(
        GroupName.Warning, [], ConsoleFilter.singleLevelMask(Levels.Warning),
        UI.Icon.Icon.create('mediumicon-warning-triangle'), selectedFilterSetting);
    this._appendGroup(
        GroupName.Info, [], ConsoleFilter.singleLevelMask(Levels.Info), UI.Icon.Icon.create('mediumicon-info-circle'),
        selectedFilterSetting);
    this._appendGroup(
        GroupName.Verbose, [], ConsoleFilter.singleLevelMask(Levels.Verbose), UI.Icon.Icon.create('mediumicon-bug'),
        selectedFilterSetting);
    const selectedTreeElementName = selectedFilterSetting.get();
    const defaultTreeElement =
        this._treeElements.find(x => x.name() === selectedTreeElementName) || this._treeElements[0];
    defaultTreeElement.select();
  }

  _appendGroup(
      name: string, parsedFilters: TextUtils.TextUtils.ParsedFilter[], levelsMask: LevelsMask, icon: UI.Icon.Icon,
      selectedFilterSetting: Common.Settings.Setting<string>): void {
    const filter = new ConsoleFilter(name, parsedFilters, null, levelsMask);
    const treeElement = new FilterTreeElement(filter, icon, selectedFilterSetting);
    this._tree.appendChild(treeElement);
    this._treeElements.push(treeElement);
  }

  clear(): void {
    for (const treeElement of this._treeElements) {
      treeElement.clear();
    }
  }

  onMessageAdded(viewMessage: ConsoleViewMessage): void {
    for (const treeElement of this._treeElements) {
      treeElement.onMessageAdded(viewMessage);
    }
  }

  shouldBeVisible(viewMessage: ConsoleViewMessage): boolean {
    if (this._selectedTreeElement instanceof ConsoleSidebarTreeElement) {
      return this._selectedTreeElement.filter().shouldBeVisible(viewMessage);
    }
    return true;
  }

  _selectionChanged(event: Common.EventTarget.EventTargetEvent): void {
    this._selectedTreeElement = (event.data as UI.TreeOutline.TreeElement);
    this.dispatchEventToListeners(Events.FilterSelected);
  }
}

export const enum Events {
  FilterSelected = 'FilterSelected',
}

class ConsoleSidebarTreeElement extends UI.TreeOutline.TreeElement {
  _filter: ConsoleFilter;

  constructor(title: string|Node, filter: ConsoleFilter) {
    super(title);
    this._filter = filter;
  }

  filter(): ConsoleFilter {
    return this._filter;
  }
}

export class URLGroupTreeElement extends ConsoleSidebarTreeElement {
  _countElement: HTMLElement;
  _messageCount: number;

  constructor(filter: ConsoleFilter) {
    super(filter.name, filter);
    this._countElement = this.listItemElement.createChild('span', 'count');
    const leadingIcons = [UI.Icon.Icon.create('largeicon-navigator-file')];
    this.setLeadingIcons(leadingIcons);
    this._messageCount = 0;
  }

  incrementAndUpdateCounter(): void {
    this._messageCount++;
    this._countElement.textContent = `${this._messageCount}`;
  }
}

export class FilterTreeElement extends ConsoleSidebarTreeElement {
  _selectedFilterSetting: Common.Settings.Setting<string>;
  _urlTreeElements: Map<string|null, URLGroupTreeElement>;
  _messageCount: number;

  constructor(filter: ConsoleFilter, icon: UI.Icon.Icon, selectedFilterSetting: Common.Settings.Setting<string>) {
    super(filter.name, filter);
    this._selectedFilterSetting = selectedFilterSetting;
    this._urlTreeElements = new Map();
    this.setLeadingIcons([icon]);
    this._messageCount = 0;
    this._updateCounter();
  }

  clear(): void {
    this._urlTreeElements.clear();
    this.removeChildren();
    this._messageCount = 0;
    this._updateCounter();
  }

  name(): string {
    return this._filter.name;
  }

  onselect(selectedByUser?: boolean): boolean {
    this._selectedFilterSetting.set(this._filter.name);
    return super.onselect(selectedByUser);
  }

  _updateCounter(): void {
    this.title = this._updateGroupTitle(this._filter.name, this._messageCount);
    this.setExpandable(Boolean(this.childCount()));
  }

  _updateGroupTitle(filterName: string, messageCount: number): string {
    const groupTitleMap = new Map([
      [GroupName.ConsoleAPI, i18nString(UIStrings.dUserMessages, {n: messageCount})],
      [GroupName.All, i18nString(UIStrings.dMessages, {n: messageCount})],
      [GroupName.Error, i18nString(UIStrings.dErrors, {n: messageCount})],
      [GroupName.Warning, i18nString(UIStrings.dWarnings, {n: messageCount})],
      [GroupName.Info, i18nString(UIStrings.dInfo, {n: messageCount})],
      [GroupName.Verbose, i18nString(UIStrings.dVerbose, {n: messageCount})],
    ]);
    return groupTitleMap.get(filterName as GroupName) || '';
  }
  onMessageAdded(viewMessage: ConsoleViewMessage): void {
    const message = viewMessage.consoleMessage();
    const shouldIncrementCounter = message.type !== SDK.ConsoleModel.MessageType.Command &&
        message.type !== SDK.ConsoleModel.MessageType.Result && !message.isGroupMessage();
    if (!this._filter.shouldBeVisible(viewMessage) || !shouldIncrementCounter) {
      return;
    }
    const child = this._childElement(message.url);
    child.incrementAndUpdateCounter();
    this._messageCount++;
    this._updateCounter();
  }

  _childElement(url?: string): URLGroupTreeElement {
    const urlValue = url || null;
    let child = this._urlTreeElements.get(urlValue);
    if (child) {
      return child;
    }

    const filter = this._filter.clone();
    const parsedURL = urlValue ? Common.ParsedURL.ParsedURL.fromString(urlValue) : null;
    if (urlValue) {
      filter.name = parsedURL ? parsedURL.displayName : urlValue;
    } else {
      filter.name = i18nString(UIStrings.other);
    }
    filter.parsedFilters.push({key: FilterType.Url, text: urlValue, negative: false, regex: undefined});
    child = new URLGroupTreeElement(filter);
    if (urlValue) {
      child.tooltip = urlValue;
    }
    this._urlTreeElements.set(urlValue, child);
    this.appendChild(child);
    return child;
  }
}

const enum GroupName {
  ConsoleAPI = 'user message',
  All = 'message',
  Error = 'error',
  Warning = 'warning',
  Info = 'info',
  Verbose = 'verbose',
}
