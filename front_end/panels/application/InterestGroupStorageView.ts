// Copyright 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as i18n from '../../core/i18n/i18n.js';
import * as UI from '../../ui/legacy/legacy.js';
import type * as DataGrid from '../../ui/components/data_grid/data_grid.js';
import type * as Protocol from '../../generated/protocol.js';
import * as SourceFrame from '../../ui/legacy/components/source_frame/source_frame.js';
import * as ApplicationComponents from './components/components.js';

import interestGroupStorageViewStyles from './interestGroupStorageView.css.js';

const UIStrings = {
  /**
  *@description Placeholder text instructing the user how to display interest group
  *details.
  */
  clickToDisplayBody: 'Click on any interest group event to display the group\'s current state',
  /**
  interestGroupStorageItems: 'InterestGroup Storage Items',
  */
};
const str_ = i18n.i18n.registerUIStrings('panels/application/InterestGroupStorageView.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);

interface InterestGroupDetailsGetter {
  getInterestGroupDetails: (owner: string, name: string) => Promise<Protocol.Storage.InterestGroupDetails|null>;
}

function eventEquals(
    a: Protocol.Storage.InterestGroupAccessedEvent, b: Protocol.Storage.InterestGroupAccessedEvent): boolean {
  return (a.accessTime === b.accessTime && a.type === b.type && a.ownerOrigin === b.ownerOrigin && a.name === b.name);
}

export class InterestGroupStorageView extends UI.SplitWidget.SplitWidget {
  private readonly interestGroupGrid = new ApplicationComponents.InterestGroupAccessGrid.InterestGroupAccessGrid();
  private events: Protocol.Storage.InterestGroupAccessedEvent[] = [];
  private detailsGetter: InterestGroupDetailsGetter;

  constructor(detailsGetter: InterestGroupDetailsGetter) {
    super(/* isVertical */ false, /* secondIsSidebar: */ true);
    this.detailsGetter = detailsGetter;

    const topPanel = new UI.Widget.VBox();
    const bottomPanel = new UI.Widget.VBox();
    topPanel.setMinimumSize(0, 80);
    this.setMainWidget(topPanel);
    bottomPanel.setMinimumSize(0, 40);
    this.setSidebarWidget(bottomPanel);

    topPanel.contentElement.appendChild(this.interestGroupGrid);
    this.interestGroupGrid.addEventListener('cellfocused', this.onFocus.bind(this));

    bottomPanel.contentElement.classList.add('placeholder');
    const centered = bottomPanel.contentElement.createChild('div');
    centered.textContent = i18nString(UIStrings.clickToDisplayBody);
  }

  wasShown(): void {
    super.wasShown();
    const sbw = this.sidebarWidget();
    if (sbw) {
      sbw.registerCSSFiles([interestGroupStorageViewStyles]);
    }
  }

  addEvent(event: Protocol.Storage.InterestGroupAccessedEvent): void {
    // Only add if not already present.
    const foundEvent = this.events.find(t => eventEquals(t, event));
    if (!foundEvent) {
      this.events.push(event);
      this.interestGroupGrid.data = this.events;
    }
  }

  clearEvents(): void {
    this.events = [];
    this.interestGroupGrid.data = this.events;
  }

  private async onFocus(event: Event): Promise<void> {
    const focusedEvent = event as DataGrid.DataGridEvents.BodyCellFocusedEvent;
    const row = focusedEvent.data.row;
    if (!row) {
      return;
    }

    const ownerOrigin = row.cells.find(cell => cell.columnId === 'event-group-owner')?.value as string;
    const name = row.cells.find(cell => cell.columnId === 'event-group-name')?.value as string;
    if (!ownerOrigin || !name) {
      return;
    }

    const details = await this.detailsGetter.getInterestGroupDetails(ownerOrigin, name);
    if (details) {
      const jsonView = await SourceFrame.JSONView.JSONView.createView(JSON.stringify(details));
      jsonView?.setMinimumSize(0, 40);
      if (jsonView) {
        this.setSidebarWidget(jsonView);
      }
    }
  }

  getEventsForTesting(): Array<Protocol.Storage.InterestGroupAccessedEvent> {
    return this.events;
  }

  getInterestGroupGridForTesting(): ApplicationComponents.InterestGroupAccessGrid.InterestGroupAccessGrid {
    return this.interestGroupGrid;
  }
}
