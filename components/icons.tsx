"use client";

import { Icon } from "@iconify/react";
import bell from "@iconify-icons/gravity-ui/bell";
import squares from "@iconify-icons/gravity-ui/layout-cells-large";
import calendar from "@iconify-icons/gravity-ui/calendar";
import clock from "@iconify-icons/gravity-ui/clock";
import gear from "@iconify-icons/gravity-ui/gear";
import plus from "@iconify-icons/gravity-ui/plus";
import arrow from "@iconify-icons/gravity-ui/arrow-right";
import chevron from "@iconify-icons/gravity-ui/chevron-right";
import check from "@iconify-icons/gravity-ui/check";
import circleCheck from "@iconify-icons/gravity-ui/circle-check";
import shield from "@iconify-icons/gravity-ui/shield-check";
import refresh from "@iconify-icons/gravity-ui/arrows-rotate-right";
import search from "@iconify-icons/gravity-ui/magnifier";
import send from "@iconify-icons/gravity-ui/paper-plane";
import pause from "@iconify-icons/gravity-ui/pause";
import play from "@iconify-icons/gravity-ui/play";
import edit from "@iconify-icons/gravity-ui/pencil";
import copy from "@iconify-icons/gravity-ui/copy";
import archive from "@iconify-icons/gravity-ui/archive";
import close from "@iconify-icons/gravity-ui/xmark";
import menu from "@iconify-icons/gravity-ui/bars";
import logout from "@iconify-icons/gravity-ui/arrow-right-from-square";
import warning from "@iconify-icons/gravity-ui/triangle-exclamation";
import lock from "@iconify-icons/gravity-ui/lock";
import link from "@iconify-icons/gravity-ui/link";
import globe from "@iconify-icons/gravity-ui/globe";
import chevronDown from "@iconify-icons/gravity-ui/chevron-down";
import inbox from "@iconify-icons/gravity-ui/tray";
import more from "@iconify-icons/gravity-ui/ellipsis";
import moon from "@iconify-icons/gravity-ui/moon";
import sun from "@iconify-icons/gravity-ui/sun";
import display from "@iconify-icons/gravity-ui/display";
import trash from "@iconify-icons/gravity-ui/trash-bin";
import info from "@iconify-icons/gravity-ui/circle-info";

const languages = {
  width: 24,
  height: 24,
  body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 8l6 6m-7 0l6-6l2-3M2 5h12M7 2h1m14 20l-5-10l-5 10m2-4h6"/>',
};

const icons = { bell, squares, calendar, clock, gear, plus, arrow, chevron, check, circleCheck, shield, refresh, search, send, pause, play, edit, copy, archive, close, menu, logout, warning, lock, link, globe, chevronDown, inbox, more, moon, sun, display, trash, info, languages };
export type IconName = keyof typeof icons;

export function Glyph({ name, className = "", size = 18 }: { name: IconName; className?: string; size?: number }) {
  return <Icon icon={icons[name]} width={size} height={size} aria-hidden="true" className={className} />;
}
