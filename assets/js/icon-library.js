/* Shared SVG icon helper. Kept as a classic script so every feature module can use it. */
(function () {
    const ICONS_PATH = '';

    window.appIcon = function appIcon(name, className = '') {
        const classes = ['svg-icon', className].filter(Boolean).join(' ');
        return `<svg class="${classes}" aria-hidden="true" focusable="false"><use href="${ICONS_PATH}#icon-${name}"></use></svg>`;
    };

    document.querySelectorAll('use[href^="assets/icons.svg#"]').forEach((use) => {
        use.setAttribute('href', use.getAttribute('href').replace('assets/icons.svg', ''));
    });
}());
