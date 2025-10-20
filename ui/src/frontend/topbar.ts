// Copyright (C) 2018 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import m from 'mithril';
import {classNames} from '../base/classnames';
import {taskTracker} from './task_tracker';
import {Popup, PopupPosition} from '../widgets/popup';
import {assertFalse} from '../base/logging';
import {OmniboxMode} from '../core/omnibox_manager';
import {AppImpl} from '../core/app_impl';
import {TraceImpl, TraceImplAttrs} from '../core/trace_impl';
import {HIDE_ERROR_ICON_ON_TOPBAR_FLAG} from '../lynx_features_flags';
import {sourceMapState} from '../source_map/source_map_state';
import {Button} from '../widgets/button';
import {lynxPerfGlobals} from '../lynx_perf/lynx_perf_globals';
import {Intent} from '../widgets/common';
import {RightSidebarTab} from '../lynx_perf/types';
import {PopupMenu, MenuItem} from '../widgets/menu';

class Progress implements m.ClassComponent<TraceImplAttrs> {
  view({attrs}: m.CVnode<TraceImplAttrs>): m.Children {
    const engine = attrs.trace.engine;
    const isLoading =
      AppImpl.instance.isLoadingTrace ||
      engine.numRequestsPending > 0 ||
      taskTracker.hasPendingTasks();
    const classes = classNames(isLoading && 'progress-anim');
    return m('.progress', {class: classes});
  }
}

class TraceErrorIcon implements m.ClassComponent<TraceImplAttrs> {
  private tracePopupErrorDismissed = false;

  view({attrs}: m.CVnode<TraceImplAttrs>) {
    const trace = attrs.trace;
    if (AppImpl.instance.embeddedMode || HIDE_ERROR_ICON_ON_TOPBAR_FLAG.get()) {
      return;
    }

    const mode = AppImpl.instance.omnibox.mode;
    const totErrors = trace.traceInfo.importErrors + trace.loadingErrors.length;
    if (totErrors === 0 || mode === OmniboxMode.Command) {
      return;
    }
    const message = Boolean(totErrors)
      ? `${totErrors} import or data loss errors detected.`
      : `Metric error detected.`;
    return m(
      '.error-box',
      m(
        Popup,
        {
          trigger: m('.popup-trigger'),
          isOpen: !this.tracePopupErrorDismissed,
          position: PopupPosition.Left,
          onChange: (shouldOpen: boolean) => {
            assertFalse(shouldOpen);
            this.tracePopupErrorDismissed = true;
          },
        },
        m('.error-popup', 'Data-loss/import error. Click for more info.'),
      ),
      m(
        'a.error',
        {href: '#!/info'},
        m(
          'i.material-icons',
          {
            title: message + ` Click for more info.`,
          },
          'announcement',
        ),
      ),
    );
  }
}

export interface TopbarAttrs {
  omnibox: m.Children;
  trace?: TraceImpl;
}

export class Topbar implements m.ClassComponent<TopbarAttrs> {
  private resizeHandler = () => {
    m.redraw();
  };

  oncreate() {
    window.addEventListener('resize', this.resizeHandler);
  }

  onremove() {
    window.removeEventListener('resize', this.resizeHandler);
  }

  private getScreenSize(): 'large' | 'medium' | 'small' {
    const width =
      window.innerWidth -
      parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
          '--right-sidebar-width',
        ),
      );
    if (width >= 1400) return 'large';
    if (width >= 800) return 'medium';
    return 'small';
  }

  private renderLynxButtons(screenSize: 'large' | 'medium' | 'small') {
    if (lynxPerfGlobals.state.lynxviewInstances.length === 0) {
      return null;
    }

    const assistantAction = () => {
      if (
        lynxPerfGlobals.state.rightSidebarTab === RightSidebarTab.TraceAssistant
      ) {
        lynxPerfGlobals.closeRightSidebar();
      } else {
        lynxPerfGlobals.changeRightSidebarTab(RightSidebarTab.TraceAssistant);
      }
    };

    const lynxViewAction = () => {
      if (lynxPerfGlobals.state.rightSidebarTab === RightSidebarTab.LynxView) {
        lynxPerfGlobals.closeRightSidebar();
      } else {
        lynxPerfGlobals.changeRightSidebarTab(RightSidebarTab.LynxView);
      }
    };

    if (screenSize === 'small') {
      // Show only overflow menu for small screens
      return m(
        PopupMenu,
        {
          trigger: m(Button, {
            className: 'lynx-overflow-menu',
            icon: 'more_horiz',
            intent: Intent.Primary,
          }),
          popupPosition: PopupPosition.BottomEnd,
        },
        m(MenuItem, {
          label: 'Trace Analysis',
          icon: 'robot',
          onclick: assistantAction,
        }),
        m(MenuItem, {
          label: 'Focus LynxView',
          icon: 'center_focus_strong',
          onclick: lynxViewAction,
        }),
      );
    } else if (screenSize === 'medium') {
      // Show icons only for medium screens
      return [
        m(Button, {
          className: 'lynx-assistant',
          icon: 'robot',
          intent: Intent.Primary,
          onclick: assistantAction,
        }),
        m(Button, {
          className: 'lynx-menu',
          icon: 'center_focus_strong',
          intent: Intent.Primary,
          onclick: lynxViewAction,
        }),
      ];
    } else {
      // Show full buttons with labels for large screens
      return [
        m(Button, {
          className: 'lynx-assistant',
          label: 'Trace Analysis',
          icon: 'robot',
          intent: Intent.Primary,
          onclick: assistantAction,
        }),
        m(Button, {
          className: 'lynx-menu',
          label: 'Focus LynxView',
          icon: 'center_focus_strong',
          intent: Intent.Primary,
          onclick: lynxViewAction,
        }),
      ];
    }
  }

  view({attrs}: m.Vnode<TopbarAttrs>) {
    const {omnibox} = attrs;
    const screenSize = this.getScreenSize();

    return m(
      '.topbar',
      {
        class: `${AppImpl.instance.sidebar.visible ? '' : 'hide-sidebar'} ${lynxPerfGlobals.state.showRightSidebar ? '' : 'hide-right-sidebar'} screen-${screenSize}`,
      },
      omnibox,
      attrs.trace && m(Progress, {trace: attrs.trace}),
      sourceMapState.state.sourceMapDecodePopup?.render(),
      this.renderLynxButtons(screenSize),
      attrs.trace && m(TraceErrorIcon, {trace: attrs.trace}),
    );
  }
}
