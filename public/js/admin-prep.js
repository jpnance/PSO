// Admin Prep Tool - Simplified

var FRANCHISES = [];
var PLAYERS = [];
var POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function formatMoney(n) {
    if (n === null || n === undefined) return '—';
    return '$' + n.toLocaleString();
}

function abbreviateName(name) {
    var parts = name.split(' ');
    if (parts.length < 2) return name;
    return parts[0].charAt(0) + '. ' + parts.slice(1).join(' ');
}

function sortedPositions(positions) {
    return positions.slice().sort(function(a, b) {
        var idxA = POSITIONS.indexOf(a);
        var idxB = POSITIONS.indexOf(b);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });
}

function positionBadge(positions) {
    if (!positions || positions.length === 0) return '';
    var sorted = sortedPositions(positions);
    var segments = sorted.map(function(pos) {
        return '<span class="position-badge__segment pos-' + pos + '">' + pos + '</span>';
    }).join('');
    return '<span class="position-badge">' + segments + '</span>';
}

var state = {
    watchlist: new Set(),
    windows: [],
    activeWindowId: null,
    activePaneIndex: 0
};

// ========== DATA LOADING ==========
function loadData() {
    return fetch('/admin/prep/data')
        .then(function(response) { return response.json(); })
        .then(function(data) {
            FRANCHISES = data.franchises;
            PLAYERS = data.players.map(function(p) {
                return {
                    id: p.id,
                    name: p.name,
                    team: p.team || '—',
                    bye: p.bye || null,
                    pos: p.positions[0] || 'N/A',
                    positions: p.positions,
                    franchise: p.franchise,
                    franchiseName: p.franchiseName,
                    salary: p.salary,
                    contract: p.contract.display,
                    contractType: p.contract.type,
                    fpts: p.fpts,
                    fptsG: p.fptsPerGame,
                    rating: p.rating,
                    rookie: p.rookie,
                    searchRank: p.searchRank,
                    relevant: p.searchRank !== null && p.searchRank < 9999999 && !(p.team == null && p.fptsPerGame === 0)
                };
            });
        });
}

// ========== STORAGE ==========
function loadState() {
    try {
        var saved = localStorage.getItem('prepDashboard');
        if (saved) {
            var parsed = JSON.parse(saved);
            state.watchlist = new Set(parsed.watchlist || []);
            state.windows = parsed.windows || getDefaultWindows();
            state.activeWindowId = parsed.activeWindowId || (state.windows[0] && state.windows[0].id);
        } else {
            state.windows = getDefaultWindows();
            state.activeWindowId = state.windows[0].id;
        }
    } catch (e) {
        state.windows = getDefaultWindows();
        state.activeWindowId = state.windows[0].id;
    }
}

function saveState() {
    try {
        localStorage.setItem('prepDashboard', JSON.stringify({
            watchlist: Array.from(state.watchlist),
            windows: state.windows,
            activeWindowId: state.activeWindowId
        }));
    } catch (e) {}
}

function getDefaultWindows() {
    return [{ id: 'w1', name: 'Window 1', panes: [] }];
}

function getActiveWindow() {
    return state.windows.find(function(w) { return w.id === state.activeWindowId; });
}

// ========== PANE MODEL ==========
// Every pane has: view, contractView, groupByPosition, sortBy, showCount
function normalizePane(pane) {
    if (typeof pane === 'string') {
        pane = { view: pane };
    }
    var defaults = getPaneDefaults(pane.view);
    return {
        view: pane.view,
        contractView: pane.contractView !== undefined ? pane.contractView : defaults.contractView,
        groupByPosition: pane.groupByPosition !== undefined ? pane.groupByPosition : (defaults.groupByPosition || false),
        sortBy: pane.sortBy || defaults.sortBy,
        showCount: pane.showCount !== undefined ? pane.showCount : defaults.showCount
    };
}

function getPaneDefaults(viewId) {
    if (viewId.startsWith('pos-')) return { contractView: 'unsigned', sortBy: 'ppg', showCount: false };
    if (viewId.startsWith('franchise-')) return { contractView: 'signed', sortBy: 'ppg', showCount: true, groupByPosition: true };
    if (viewId === 'ufa' || viewId === 'rfa') return { contractView: 'all', sortBy: 'ppg', showCount: false };
    if (viewId === 'rookies') return { contractView: 'all', sortBy: 'ppg', showCount: false };
    if (viewId === 'watchlist') return { contractView: 'all', sortBy: 'ppg', showCount: false };
    if (viewId.startsWith('bye-')) return { contractView: 'unsigned', sortBy: 'ppg', showCount: false };
    return { contractView: 'all', sortBy: 'ppg', showCount: false };
}

// ========== VIEW DEFINITIONS ==========
function getViewConfig(viewId) {
    var configs = {
        'pos-any': { title: 'Any', filter: function() { return true; } },
        'pos-qb': { title: 'QB', filter: function(p) { return p.pos === 'QB'; }, posColor: 'qb' },
        'pos-rb': { title: 'RB', filter: function(p) { return p.pos === 'RB'; }, posColor: 'rb' },
        'pos-wr': { title: 'WR', filter: function(p) { return p.pos === 'WR'; }, posColor: 'wr' },
        'pos-rbwr': { title: 'RB/WR', filter: function(p) { return p.pos === 'RB' || p.pos === 'WR'; } },
        'pos-te': { title: 'TE', filter: function(p) { return p.pos === 'TE'; }, posColor: 'te' },
        'pos-dl': { title: 'DL', filter: function(p) { return p.pos === 'DL'; }, posColor: 'idp' },
        'pos-lb': { title: 'LB', filter: function(p) { return p.pos === 'LB'; }, posColor: 'idp' },
        'pos-db': { title: 'DB', filter: function(p) { return p.pos === 'DB'; }, posColor: 'idp' },
        'pos-k': { title: 'K', filter: function(p) { return p.pos === 'K'; }, posColor: 'k' },
        'ufa': { title: 'UFA', filter: function(p) { return p.contractType === 'ufa'; } },
        'rfa': { title: 'RFA', filter: function(p) { return p.contractType === 'rfa'; } },
        'rookies': { title: 'Rookies', filter: function(p) { return p.rookie; } },
        'watchlist': { title: 'Watchlist', filter: function(p) { return state.watchlist.has(p.id); } }
    };

    // Bye week views
    for (var week = 1; week <= 14; week++) {
        (function(w) {
            configs['bye-' + w] = {
                title: 'Bye ' + w,
                filter: function(p) { return p.bye === w; }
            };
        })(week);
    }

    // Franchise views
    FRANCHISES.forEach(function(f) {
        configs['franchise-' + f.id] = {
            title: f.name,
            filter: function(p) { return p.franchise === f.id; },
            franchiseColor: f.color
        };
    });

    return configs[viewId] || { title: viewId, filter: function() { return true; } };
}

// ========== SORTING & FILTERING ==========
function applyContractFilter(players, contractView) {
    if (contractView === 'all') return players;
    if (contractView === 'unsigned') {
        return players.filter(function(p) { return p.contractType === 'ufa' || p.contractType === 'rfa'; });
    }
    if (contractView === 'signed') {
        return players.filter(function(p) { return p.contractType === 'signed'; });
    }
    return players;
}

function sortPlayers(players, sortBy, groupByPosition) {
    var sorted = players.slice();
    
    sorted.sort(function(a, b) {
        // Group by position first if enabled
        if (groupByPosition) {
            var posA = POSITIONS.indexOf(a.pos);
            var posB = POSITIONS.indexOf(b.pos);
            if (posA !== posB) return posA - posB;
        }
        // Then by selected field
        return compareByField(a, b, sortBy);
    });
    
    return sorted;
}

function compareByField(a, b, field) {
    switch (field) {
        case 'fpts': return b.fpts - a.fpts;
        case 'ppg': return b.fptsG - a.fptsG;
        case 'salary': return b.salary - a.salary;
        case 'rating': return b.rating - a.rating;
        case 'name': return a.name.localeCompare(b.name);
        default: return b.fpts - a.fpts;
    }
}

// ========== RENDERING ==========
function renderWindowTabs() {
    var container = document.getElementById('windowTabs');
    container.innerHTML = '';

    state.windows.forEach(function(win) {
        var isActive = win.id === state.activeWindowId;
        var tab = document.createElement('button');
        tab.className = 'window-tab' + (isActive ? ' window-tab--active' : '');
        tab.dataset.windowId = win.id;
        var showClose = isActive;
        tab.innerHTML = '<span class="window-tab__name">' + win.name + '</span>' +
            (showClose ? '<span class="window-tab__close">&times;</span>' : '');

        tab.addEventListener('click', function(e) {
            if (e.target.classList.contains('window-tab__close')) {
                deleteWindow(win.id);
            } else {
                switchToWindow(win.id);
            }
        });

        tab.addEventListener('dblclick', function(e) {
            if (!e.target.classList.contains('window-tab__close')) {
                startRenameWindow(win.id);
            }
        });

        container.appendChild(tab);
    });

    var addBtn = document.createElement('button');
    addBtn.className = 'window-tab window-tab--add';
    addBtn.innerHTML = '<i class="fa fa-plus"></i>';
    addBtn.addEventListener('click', createNewWindow);
    container.appendChild(addBtn);
}

function switchToWindow(windowId) {
    if (state.activeWindowId === windowId) return;
    state.activeWindowId = windowId;
    state.activePaneIndex = 0;
    saveState();
    renderWindowTabs();
    renderPanes();
}

function createNewWindow() {
    var newWin = { id: 'w' + Date.now(), name: 'Window ' + (state.windows.length + 1), panes: [] };
    state.windows.push(newWin);
    state.activeWindowId = newWin.id;
    saveState();
    renderWindowTabs();
    renderPanes();
    setTimeout(function() { startRenameWindow(newWin.id); }, 50);
}

function deleteWindow(windowId) {
    var idx = state.windows.findIndex(function(w) { return w.id === windowId; });
    if (idx > -1) {
        state.windows.splice(idx, 1);
        if (state.windows.length === 0) {
            state.windows.push({ id: 'w' + Date.now(), name: 'Window 1', panes: [] });
        }
        if (state.activeWindowId === windowId) {
            state.activeWindowId = state.windows[0].id;
        }
        saveState();
        renderWindowTabs();
        renderPanes();
    }
}

function startRenameWindow(windowId) {
    var tab = document.querySelector('.window-tab[data-window-id="' + windowId + '"]');
    var win = state.windows.find(function(w) { return w.id === windowId; });
    if (!tab || !win) return;

    tab.classList.add('window-tab--editing');
    tab.innerHTML = '<input type="text" value="' + win.name + '" />';
    var input = tab.querySelector('input');
    input.focus();
    input.select();

    function finishRename() {
        win.name = input.value.trim() || win.name;
        saveState();
        renderWindowTabs();
    }

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') finishRename();
        else if (e.key === 'Escape') renderWindowTabs();
    });
}

function renderPanes() {
    var area = document.getElementById('paneArea');
    area.innerHTML = '';

    var win = getActiveWindow();
    if (!win) return;

    // Ensure activePaneIndex is valid
    if (state.activePaneIndex >= win.panes.length) {
        state.activePaneIndex = Math.max(0, win.panes.length - 1);
    }

    // Render mobile pane switcher
    var switcher = document.getElementById('paneSwitcher');
    switcher.innerHTML = '';
    win.panes.forEach(function(paneData, idx) {
        var config = getViewConfig(normalizePane(paneData).view);
        var tab = document.createElement('button');
        tab.className = 'pane-switcher__tab' + (idx === state.activePaneIndex ? ' pane-switcher__tab--active' : '');
        tab.textContent = config.title;
        tab.dataset.paneIndex = idx;
        tab.addEventListener('click', function() {
            state.activePaneIndex = idx;
            renderPanes();
        });
        switcher.appendChild(tab);
    });

    win.panes.forEach(function(paneData, paneIndex) {
        paneData = normalizePane(paneData);
        var config = getViewConfig(paneData.view);
        
        var players = PLAYERS.filter(config.filter);
        // Exclude irrelevant players (bad searchRank) unless they're rostered
        players = players.filter(function(p) {
            return p.relevant || p.franchise;
        });
        players = applyContractFilter(players, paneData.contractView);
        players = sortPlayers(players, paneData.sortBy, paneData.groupByPosition);

        var pane = document.createElement('div');
        pane.className = 'pane' + (paneIndex === state.activePaneIndex ? ' pane--active' : '');

        // Header styling
        var headerStyle = '';
        var headerClass = 'pane__header';
        if (config.posColor) {
            headerClass += ' pane__header--' + config.posColor;
        } else if (config.franchiseColor) {
            headerStyle = 'background: ' + config.franchiseColor + '15; border-bottom-color: ' + config.franchiseColor + ';';
        }

        // Contract filter buttons
        var filterHtml = '<div class="pane__filter" data-pane-index="' + paneIndex + '">' +
            '<button class="pane__filter-btn' + (paneData.contractView === 'all' ? ' pane__filter-btn--active' : '') + '" data-filter="all">All</button>' +
            '<button class="pane__filter-btn' + (paneData.contractView === 'unsigned' ? ' pane__filter-btn--active' : '') + '" data-filter="unsigned">Unsigned</button>' +
            '<button class="pane__filter-btn' + (paneData.contractView === 'signed' ? ' pane__filter-btn--active' : '') + '" data-filter="signed">Signed</button>' +
        '</div>' +
        '<button class="pane__group-toggle' + (paneData.groupByPosition ? ' pane__group-toggle--active' : '') + '" data-pane-index="' + paneIndex + '" title="Group by position"><i class="fa fa-th-list"></i></button>';

        // Settings dropdown
        var settingsHtml = '<div class="pane__settings-container">' +
            '<button class="pane__settings-btn" data-pane-index="' + paneIndex + '"><i class="fa fa-cog"></i></button>' +
            '<div class="pane__settings-dropdown" id="paneSettings' + paneIndex + '">' +
                '<div class="pane__settings-group">' +
                    '<label class="pane__settings-label">Sort by</label>' +
                    '<select class="pane__settings-select" data-setting="sortBy" data-pane-index="' + paneIndex + '">' +
                        '<option value="fpts"' + (paneData.sortBy === 'fpts' ? ' selected' : '') + '>FPTS</option>' +
                        '<option value="ppg"' + (paneData.sortBy === 'ppg' ? ' selected' : '') + '>PPG</option>' +
                        '<option value="salary"' + (paneData.sortBy === 'salary' ? ' selected' : '') + '>Salary</option>' +
                        '<option value="rating"' + (paneData.sortBy === 'rating' ? ' selected' : '') + '>Rating</option>' +
                        '<option value="name"' + (paneData.sortBy === 'name' ? ' selected' : '') + '>Name</option>' +
                    '</select>' +
                '</div>' +
                '<div class="pane__settings-group">' +
                    '<label class="pane__settings-checkbox">' +
                        '<input type="checkbox" data-setting="showCount" data-pane-index="' + paneIndex + '"' + (paneData.showCount ? ' checked' : '') + '>' +
                        ' Show count' +
                    '</label>' +
                '</div>' +
            '</div>' +
        '</div>';

        var countHtml = paneData.showCount ? '<span class="pane__count" data-pane-index="' + paneIndex + '">' + players.length + '</span>' : '';

        var headerHtml = '<div class="' + headerClass + '"' + (headerStyle ? ' style="' + headerStyle + '"' : '') + '>' +
            '<span class="pane__title" data-pane-index="' + paneIndex + '">' + config.title + '</span>' +
            filterHtml +
            countHtml +
            settingsHtml +
            '<button class="pane__close" data-pane-index="' + paneIndex + '">&times;</button>' +
        '</div>';

        var isFranchisePane = paneData.view.startsWith('franchise-');
        
        var tableHtml = '<div class="pane__body"><table class="player-table"><tbody>';
        players.forEach(function(p) {
            var isWatched = state.watchlist.has(p.id);
            var owner = p.franchise ? FRANCHISES.find(function(f) { return f.id === p.franchise; }) : null;
            var contractClass = p.contractType === 'ufa' ? 'contract-ufa' : (p.contractType === 'rfa' ? 'contract-rfa' : 'contract-signed');

            tableHtml += '<tr class="' + (isWatched ? 'watched' : '') + '" data-player-id="' + p.id + '">' +
                '<td><span class="name-full">' + p.name + '</span><span class="name-short">' + abbreviateName(p.name) + '</span>' + (isWatched ? '<i class="fa fa-star watched-indicator"></i>' : '') + '</td>' +
                '<td class="muted">' + p.team + '</td>' +
                '<td class="num muted">' + (p.bye || '—') + '</td>' +
                '<td>' + positionBadge(p.positions) + '</td>' +
                (isFranchisePane ? '' : '<td class="muted owner" title="' + (owner ? owner.name : '') + '">' + (owner ? owner.name : '—') + '</td>') +
                '<td><span class="contract ' + contractClass + '">' + p.contract + '</span></td>' +
                '<td class="num">' + (p.salary > 0 ? formatMoney(p.salary) : '—') + '</td>' +
                '<td class="num"><strong>' + p.fpts.toFixed(1) + '</strong></td>' +
                '<td class="num">' + p.fptsG.toFixed(2) + '</td>' +
                '<td class="num"><span class="rating rating--' + p.rating + '">' + p.rating + '</span></td>' +
            '</tr>';
        });
        tableHtml += '</tbody></table></div>';

        pane.innerHTML = headerHtml + tableHtml;
        area.appendChild(pane);
    });

    // Event handlers for panes
    document.querySelectorAll('.pane__close').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var idx = parseInt(btn.dataset.paneIndex);
            var win = getActiveWindow();
            if (win) {
                win.panes.splice(idx, 1);
                if (state.activePaneIndex >= win.panes.length) {
                    state.activePaneIndex = Math.max(0, win.panes.length - 1);
                }
                saveState();
                renderPanes();
            }
        });
    });

    document.querySelectorAll('.pane__title').forEach(function(title) {
        title.addEventListener('click', function() {
            var idx = parseInt(title.dataset.paneIndex);
            openExpandedPane(idx);
        });
    });

    document.querySelectorAll('.pane__count').forEach(function(count) {
        count.addEventListener('click', function() {
            var idx = parseInt(count.dataset.paneIndex);
            var win = getActiveWindow();
            if (win) {
                win.panes[idx] = normalizePane(win.panes[idx]);
                win.panes[idx].showCount = false;
                saveState();
                renderPanes();
            }
        });
    });

    document.querySelectorAll('.pane__filter').forEach(function(filterGroup) {
        filterGroup.addEventListener('click', function(e) {
            var btn = e.target.closest('.pane__filter-btn');
            if (!btn) return;
            var idx = parseInt(filterGroup.dataset.paneIndex);
            var win = getActiveWindow();
            if (win) {
                win.panes[idx] = normalizePane(win.panes[idx]);
                win.panes[idx].contractView = btn.dataset.filter;
                saveState();
                renderPanes();
            }
        });
    });

    document.querySelectorAll('.pane__group-toggle').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var idx = parseInt(btn.dataset.paneIndex);
            var win = getActiveWindow();
            if (win) {
                win.panes[idx] = normalizePane(win.panes[idx]);
                win.panes[idx].groupByPosition = !win.panes[idx].groupByPosition;
                saveState();
                renderPanes();
            }
        });
    });

    document.querySelectorAll('.pane__settings-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = btn.dataset.paneIndex;
            var dropdown = document.getElementById('paneSettings' + idx);
            // Close all other dropdowns first
            document.querySelectorAll('.pane__settings-dropdown.show').forEach(function(d) {
                if (d !== dropdown) d.classList.remove('show');
            });
            dropdown.classList.toggle('show');
        });
    });

    document.querySelectorAll('.pane__settings-select').forEach(function(select) {
        select.addEventListener('change', function() {
            var idx = parseInt(select.dataset.paneIndex);
            var setting = select.dataset.setting;
            var win = getActiveWindow();
            if (win) {
                win.panes[idx] = normalizePane(win.panes[idx]);
                win.panes[idx][setting] = select.value;
                saveState();
                renderPanes();
            }
        });
    });

    document.querySelectorAll('.pane__settings-checkbox input').forEach(function(cb) {
        cb.addEventListener('change', function() {
            var idx = parseInt(cb.dataset.paneIndex);
            var setting = cb.dataset.setting;
            var win = getActiveWindow();
            if (win) {
                win.panes[idx] = normalizePane(win.panes[idx]);
                win.panes[idx][setting] = cb.checked;
                saveState();
                renderPanes();
            }
        });
    });

    document.querySelectorAll('.player-table tr[data-player-id]').forEach(function(row) {
        row.addEventListener('click', function() {
            var playerId = row.dataset.playerId;
            if (state.watchlist.has(playerId)) {
                state.watchlist.delete(playerId);
            } else {
                state.watchlist.add(playerId);
            }
            saveState();
            // Preserve scroll positions
            var scrollPositions = [];
            document.querySelectorAll('.pane__body').forEach(function(body) {
                scrollPositions.push(body.scrollTop);
            });
            renderPanes();
            document.querySelectorAll('.pane__body').forEach(function(body, i) {
                if (scrollPositions[i] !== undefined) {
                    body.scrollTop = scrollPositions[i];
                }
            });
        });
    });
}

// ========== FRANCHISE MODAL ==========
function openFranchiseModal() {
    document.getElementById('franchiseModal').classList.add('show');
    document.getElementById('franchiseModalOverlay').classList.add('show');
    renderFranchiseGrid();
}

function closeFranchiseModal() {
    document.getElementById('franchiseModal').classList.remove('show');
    document.getElementById('franchiseModalOverlay').classList.remove('show');
    document.getElementById('posTooltip').classList.remove('show');
}

function renderFranchiseGrid() {
    var grid = document.getElementById('franchiseGrid');
    grid.innerHTML = '';

    FRANCHISES.forEach(function(f) {
        var players = PLAYERS.filter(function(p) { return p.franchise === f.id; });
        var posCounts = {};
        var posPlayers = {};
        
        POSITIONS.forEach(function(pos) {
            var filtered = players.filter(function(p) { return p.pos === pos; });
            posCounts[pos] = filtered.length;
            posPlayers[pos] = filtered;
        });

        var card = document.createElement('div');
        card.className = 'franchise-card';
        card.style.backgroundColor = f.color + '20';

        var posHtml = '';
        POSITIONS.forEach(function(pos) {
            var count = posCounts[pos];
            var plist = posPlayers[pos];
            var zeroClass = count === 0 ? ' franchise-card__pos--zero' : ' franchise-card__pos--has-players';
            
            var tooltipData = '';
            if (plist.length > 0) {
                plist.sort(function(a, b) { return b.fpts - a.fpts; });
                var rows = plist.map(function(p) {
                    var sal = p.salary > 0 ? formatMoney(p.salary) : '—';
                    return '<tr><td>' + p.name + '</td><td class="num">' + sal + '</td><td class="num">' + p.fpts.toFixed(1) + '</td></tr>';
                }).join('');
                tooltipData = ' data-tooltip="<table class=\'pos-tooltip__table\'>' + rows.replace(/"/g, '&quot;') + '</table>"';
            }
            
            posHtml += '<span class="franchise-card__pos pos-' + pos.toLowerCase() + zeroClass + '"' + tooltipData + '>' + pos + ': ' + count + '</span>';
        });

        card.innerHTML = '<div class="franchise-card__header"><span class="franchise-card__name">' + f.name + '</span>' +
            '<span class="franchise-card__cash">' + formatMoney(f.capAvailable) + '</span></div>' +
            '<div class="franchise-card__positions">' + posHtml + '</div>' +
            '<div class="franchise-card__footer"><span>' + players.length + '/35</span></div>';

        grid.appendChild(card);
    });

    // Tooltip handlers
    var tooltip = document.getElementById('posTooltip');
    document.querySelectorAll('.franchise-card__pos[data-tooltip]').forEach(function(el) {
        el.addEventListener('mouseenter', function() {
            tooltip.className = 'pos-tooltip show';
            var pos = el.textContent.split(':')[0].toLowerCase();
            if (['dl', 'lb', 'db'].includes(pos)) pos = 'idp';
            tooltip.classList.add('pos-tooltip--' + pos);
            tooltip.innerHTML = el.getAttribute('data-tooltip');
            var rect = el.getBoundingClientRect();
            var tooltipRect = tooltip.getBoundingClientRect();
            var top = rect.bottom + 8;
            var left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
            if (left + tooltipRect.width > window.innerWidth - 10) left = window.innerWidth - tooltipRect.width - 10;
            if (left < 10) left = 10;
            if (top + tooltipRect.height > window.innerHeight - 10) top = rect.top - tooltipRect.height - 8;
            tooltip.style.top = top + 'px';
            tooltip.style.left = left + 'px';
        });
        el.addEventListener('mouseleave', function() { tooltip.className = 'pos-tooltip'; });
    });
}

// ========== EXPANDED PANE MODAL ==========
function openExpandedPane(paneIndex) {
    var win = getActiveWindow();
    if (!win || !win.panes[paneIndex]) return;
    
    var paneData = normalizePane(win.panes[paneIndex]);
    var config = getViewConfig(paneData.view);
    
    var players = PLAYERS.filter(config.filter);
    players = players.filter(function(p) {
        return p.relevant || p.franchise;
    });
    players = applyContractFilter(players, paneData.contractView);
    players = sortPlayers(players, paneData.sortBy, paneData.groupByPosition);
    
    var isFranchisePane = paneData.view.startsWith('franchise-');
    
    // Set header styling
    var header = document.getElementById('expandedPaneHeader');
    header.style.background = '';
    header.style.borderBottomColor = '';
    if (config.posColor) {
        header.style.background = 'var(--pos-' + config.posColor + '-bg)';
        header.style.borderBottomColor = 'var(--pos-' + config.posColor + '-text)';
    } else if (config.franchiseColor) {
        header.style.background = config.franchiseColor + '15';
        header.style.borderBottomColor = config.franchiseColor;
    }
    
    document.getElementById('expandedPaneTitle').textContent = config.title + ' (' + players.length + ')';
    
    var tableHtml = '<table class="player-table"><tbody>';
    players.forEach(function(p) {
        var isWatched = state.watchlist.has(p.id);
        var owner = p.franchise ? FRANCHISES.find(function(f) { return f.id === p.franchise; }) : null;
        var contractClass = p.contractType === 'ufa' ? 'contract-ufa' : (p.contractType === 'rfa' ? 'contract-rfa' : 'contract-signed');

        tableHtml += '<tr class="' + (isWatched ? 'watched' : '') + '">' +
            '<td><span class="name-full">' + p.name + '</span><span class="name-short">' + abbreviateName(p.name) + '</span>' + (isWatched ? '<i class="fa fa-star watched-indicator"></i>' : '') + '</td>' +
            '<td class="muted">' + p.team + '</td>' +
            '<td class="num muted">' + (p.bye || '—') + '</td>' +
            '<td>' + positionBadge(p.positions) + '</td>' +
            (isFranchisePane ? '' : '<td class="muted owner" title="' + (owner ? owner.name : '') + '">' + (owner ? owner.name : '—') + '</td>') +
            '<td><span class="contract ' + contractClass + '">' + p.contract + '</span></td>' +
            '<td class="num">' + (p.salary > 0 ? formatMoney(p.salary) : '—') + '</td>' +
            '<td class="num"><strong>' + p.fpts.toFixed(1) + '</strong></td>' +
            '<td class="num">' + p.fptsG.toFixed(2) + '</td>' +
            '<td class="num"><span class="rating rating--' + p.rating + '">' + p.rating + '</span></td>' +
        '</tr>';
    });
    tableHtml += '</tbody></table>';
    
    document.getElementById('expandedPaneBody').innerHTML = tableHtml;
    document.getElementById('expandedPaneModal').classList.add('show');
    document.getElementById('expandedPaneOverlay').classList.add('show');
}

function closeExpandedPane() {
    document.getElementById('expandedPaneModal').classList.remove('show');
    document.getElementById('expandedPaneOverlay').classList.remove('show');
}

// ========== ADD PANE MODAL ==========
function openAddPaneModal() {
    updateAddPaneModalState();
    document.getElementById('addPaneModal').classList.add('show');
    document.getElementById('addPaneModalOverlay').classList.add('show');
}

function closeAddPaneModal() {
    document.getElementById('addPaneModal').classList.remove('show');
    document.getElementById('addPaneModalOverlay').classList.remove('show');
}

function updateAddPaneModalState() {
    var win = getActiveWindow();
    if (!win) return;
    
    document.querySelectorAll('.add-pane-modal__item[data-view]').forEach(function(item) {
        var viewId = item.dataset.view;
        var exists = win.panes.some(function(p) { return normalizePane(p).view === viewId; });
        item.classList.toggle('add-pane-modal__item--disabled', exists);
    });
    
    // Populate franchise grid
    var franchiseGrid = document.getElementById('addPaneFranchiseGrid');
    franchiseGrid.innerHTML = '';
    FRANCHISES.forEach(function(f) {
        var viewId = 'franchise-' + f.id;
        var exists = win.panes.some(function(p) { return normalizePane(p).view === viewId; });
        var item = document.createElement('div');
        item.className = 'add-pane-modal__item' + (exists ? ' add-pane-modal__item--disabled' : '');
        item.dataset.view = viewId;
        item.style.backgroundColor = f.color + '20';
        item.textContent = f.name;
        franchiseGrid.appendChild(item);
    });

    // Populate bye week grid
    var byeGrid = document.getElementById('addPaneByeGrid');
    byeGrid.innerHTML = '';
    for (var week = 1; week <= 14; week++) {
        var viewId = 'bye-' + week;
        var exists = win.panes.some(function(p) { return normalizePane(p).view === viewId; });
        var item = document.createElement('div');
        item.className = 'add-pane-modal__item' + (exists ? ' add-pane-modal__item--disabled' : '');
        item.dataset.view = viewId;
        item.textContent = week;
        byeGrid.appendChild(item);
    }
}

function addPane(viewId) {
    var win = getActiveWindow();
    if (!win) return;
    var exists = win.panes.some(function(p) { return normalizePane(p).view === viewId; });
    if (exists) return;
    
    var defaults = getPaneDefaults(viewId);
    win.panes.push({ view: viewId, contractView: defaults.contractView, sortBy: defaults.sortBy, groupByPosition: defaults.groupByPosition || false, showCount: defaults.showCount || false });
    state.activePaneIndex = win.panes.length - 1;
    saveState();
    renderPanes();
    updateAddPaneModalState();
}

// ========== SETTINGS ==========
function clearWatchlist() {
    state.watchlist = new Set();
    saveState();
    renderPanes();
}

function resetAll() {
    if (confirm('Reset all windows and clear watchlist?')) {
        localStorage.removeItem('prepDashboard');
        state.watchlist = new Set();
        state.windows = getDefaultWindows();
        state.activeWindowId = state.windows[0].id;
        renderWindowTabs();
        renderPanes();
    }
}

// ========== EVENT HANDLERS ==========
document.getElementById('franchisesBtn').addEventListener('click', openFranchiseModal);
document.getElementById('franchiseModalClose').addEventListener('click', closeFranchiseModal);
document.getElementById('franchiseModalOverlay').addEventListener('click', closeFranchiseModal);

document.getElementById('addPaneBtn').addEventListener('click', openAddPaneModal);
document.getElementById('addPaneModalClose').addEventListener('click', closeAddPaneModal);
document.getElementById('addPaneModalOverlay').addEventListener('click', closeAddPaneModal);

document.getElementById('expandedPaneClose').addEventListener('click', closeExpandedPane);
document.getElementById('expandedPaneOverlay').addEventListener('click', closeExpandedPane);

document.getElementById('addPaneModal').addEventListener('click', function(e) {
    var item = e.target.closest('.add-pane-modal__item');
    if (!item) return;
    
    var viewId = item.dataset.view;
    if (item.classList.contains('add-pane-modal__item--disabled')) {
        // Remove the pane
        removePane(viewId);
    } else {
        // Add the pane
        addPane(viewId);
    }
});

function removePane(viewId) {
    var win = getActiveWindow();
    if (!win) return;
    var idx = win.panes.findIndex(function(p) { return normalizePane(p).view === viewId; });
    if (idx > -1) {
        win.panes.splice(idx, 1);
        if (state.activePaneIndex >= win.panes.length) {
            state.activePaneIndex = Math.max(0, win.panes.length - 1);
        }
        saveState();
        renderPanes();
        updateAddPaneModalState();
    }
}

document.getElementById('settingsBtn').addEventListener('click', function() {
    document.getElementById('settingsDropdown').classList.toggle('show');
});

document.getElementById('clearWatchlist').addEventListener('click', function() {
    clearWatchlist();
    document.getElementById('settingsDropdown').classList.remove('show');
});

document.getElementById('resetAll').addEventListener('click', function() {
    resetAll();
    document.getElementById('settingsDropdown').classList.remove('show');
});

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('#settingsBtn') && !e.target.closest('#settingsDropdown')) {
        document.getElementById('settingsDropdown').classList.remove('show');
    }
    if (!e.target.closest('.pane__settings-container')) {
        document.querySelectorAll('.pane__settings-dropdown.show').forEach(function(d) {
            d.classList.remove('show');
        });
    }
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeFranchiseModal();
        closeAddPaneModal();
    }
});

// ========== INIT ==========
loadData()
    .then(function() {
        loadState();
        renderWindowTabs();
        renderPanes();
    })
    .catch(function(error) {
        console.error('Failed to load data:', error);
        document.getElementById('paneArea').innerHTML = '<div class="loading-message">Failed to load player data. Please refresh.</div>';
    });
