const bg      = '#090d15';
const bgCard   = '#0d1422';
const bgMuted  = '#162035';
const bgInput  = 'rgba(196,196,196,0.09)';
const primary  = '#237be7';
const border   = '#1e2d4a';
const text     = '#d6e4f7';
const textMuted= '#6b8cad';

export const selectOptionColors = {
    option: (provided, state) => ({
        ...provided,
        backgroundColor: state.isSelected
            ? primary
            : state.isFocused
                ? bgMuted
                : bgCard,
        color: text,
        fontSize: 12,
        cursor: 'pointer',
        padding: '6px 12px',
    }),
    control: (provided, state) => ({
        ...provided,
        background: bgInput,
        borderRadius: 45,
        border: `1px solid ${state.isFocused ? primary : 'transparent'}`,
        boxShadow: state.isFocused ? `0 0 0 1px ${primary}` : 'none',
        height: 32,
        minHeight: 32,
        width: '100%',
        cursor: 'pointer',
        '&:hover': { borderColor: primary },
    }),
    valueContainer: provided => ({ ...provided, padding: '0 12px' }),
    singleValue: provided => ({ ...provided, color: text, fontSize: 13 }),
    placeholder: provided => ({ ...provided, color: textMuted, fontSize: 13 }),
    menuPortal: provided => ({ ...provided, zIndex: 9999 }),
    menu: provided => ({
        ...provided,
        background: bgCard,
        border: `1px solid ${border}`,
        borderRadius: 12,
        overflow: 'hidden',
        zIndex: 9999,
    }),
    menuList: provided => ({ ...provided, padding: 4 }),
    input: provided => ({ ...provided, color: text }),
    indicatorSeparator: () => ({ display: 'none' }),
    dropdownIndicator: provided => ({ ...provided, color: textMuted, padding: '0 6px' }),
};

export const modalStyle = {
    content: {
        padding: 0,
        borderRadius: 12,
        background: bgCard,
        border: `1px solid ${border}`,
    },
    overlay: {
        backgroundColor: 'rgba(0,0,0,0.7)',
    },
};
