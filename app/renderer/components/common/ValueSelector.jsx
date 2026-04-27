import React from 'react';
import { observer } from 'mobx-react-lite';
import Select from 'react-select';
import { selectOptionColors } from '@styles';

const ValueSelector = ({ options, onChange, defaultValue = undefined, value = undefined, formatOptionLabel = undefined }) =>
    <Select
        className="form-select"
        styles={selectOptionColors}
        options={options}
        value={value}
        defaultValue={defaultValue}
        getOptionLabel={option => option.label}
        formatOptionLabel={formatOptionLabel}
        onChange={value => onChange(value)}
        menuPortalTarget={document.body}
        menuPosition="fixed"
        menuPlacement="auto" />;

export default observer(ValueSelector);
