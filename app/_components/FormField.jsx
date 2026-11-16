'use client';

import { Children, isValidElement } from 'react';
import { cn } from '../../lib/cn';
import { UI_TYPE } from '../../lib/ui-typography';

function containsRequiredControl(children) {
  return Children.toArray(children).some((child) => {
    if (!isValidElement(child)) return false;
    if (
      child.props.required ||
      child.props['aria-required'] === true ||
      child.props['aria-required'] === 'true'
    ) return true;
    return containsRequiredControl(child.props.children);
  });
}

/**
 * Labeled form control for dashboard grids and system forms.
 * Always keeps label above the control; use on flex/grid parents with `items-start`
 * so a tall hint never stretches sibling fields.
 *
 * @param {{
 *   label: string,
 *   children: import('react').ReactNode,
 *   hint?: string,
 *   className?: string,
 *   labelClassName?: string,
 *   htmlFor?: string,
 *   as?: 'label' | 'div',
 *   required?: boolean,
 * }} props
 */
export function FormField({
  label,
  children,
  hint = null,
  className = '',
  labelClassName = '',
  htmlFor,
  as = 'label',
  required,
}) {
  const Tag = as === 'div' ? 'div' : 'label';
  const isRequired = required ?? containsRequiredControl(children);
  return (
    <Tag
      htmlFor={as === 'label' ? htmlFor : undefined}
      className={cn(
        /* w-full: em coluna, self-start sozinho encolhe o campo ao conteúdo (e-mail ≠ senha). */
        'ui-form-field flex w-full min-w-0 flex-col gap-1.5',
        isRequired && 'ui-form-field--required',
        className
      )}
    >
      <span
        className={cn(
          UI_TYPE.label,
          labelClassName
        )}
      >
        {label}
      </span>
      <div className="w-full min-w-0">{children}</div>
      {hint ? (
        <p className={cn("m-0", UI_TYPE.supporting)}>{hint}</p>
      ) : null}
    </Tag>
  );
}

/** Flex row for FormFields — `items-start` prevents height bleed across columns. */
export const formFieldRowClass = 'flex flex-wrap items-start gap-2.5';

/** Shared control width in profile / candidate grids. */
export const formFieldGrowClass = 'min-w-0 flex-[1_1_140px]';

/** Softer label for public candidate / Motivators identity screens. */
export const formFieldCandLabelClass =
  'font-ui text-xs font-normal normal-case tracking-normal text-ink-muted';
