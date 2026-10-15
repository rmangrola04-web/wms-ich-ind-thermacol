import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';

export interface SearchableOption {
  label: string;
  value: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  options: (string | SearchableOption)[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = '-- Select Option --',
  className = '',
  disabled = false,
  required = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Normalize options to SearchableOption[]
  const normalizedOptions: SearchableOption[] = useMemo(() => {
    return options.map(opt => {
      if (typeof opt === 'string') {
        return { label: opt, value: opt };
      }
      return opt;
    });
  }, [options]);

  // Find currently selected option
  const selectedOption = normalizedOptions.find(opt => opt.value === value || opt.label === value);

  // Flexible substring search filter (matches anywhere in label, value, or sublabel)
  const filteredOptions = useMemo(() => {
    if (!query.trim()) return normalizedOptions;
    const q = query.toLowerCase().trim();
    return normalizedOptions.filter(opt => {
      const labelMatch = opt.label.toLowerCase().includes(q);
      const valueMatch = opt.value.toLowerCase().includes(q);
      const subMatch = opt.sublabel ? opt.sublabel.toLowerCase().includes(q) : false;
      return labelMatch || valueMatch || subMatch;
    });
  }, [normalizedOptions, query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (optValue: string) => {
    onChange(optValue);
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div className={`relative w-full ${className}`} ref={containerRef}>
      {/* Trigger Button / Display */}
      <div
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }}
        className={`w-full bg-white border rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-center justify-between transition cursor-pointer select-none ${
          disabled ? 'bg-slate-100 opacity-60 cursor-not-allowed border-slate-200 text-slate-400' :
          isOpen ? 'border-blue-500 ring-2 ring-blue-500/20 text-slate-900 shadow-sm' :
          'border-slate-300 text-slate-900 hover:border-slate-400'
        }`}
      >
        <span className="truncate pr-2">
          {selectedOption ? selectedOption.label : <span className="text-slate-400 font-normal">{placeholder}</span>}
        </span>
        <div className="flex items-center gap-1.5 shrink-0 text-slate-400">
          {value && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
                setQuery('');
              }}
              className="p-0.5 hover:text-slate-600 rounded transition"
              title="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180 text-blue-600' : ''}`} />
        </div>
      </div>

      {/* Dropdown Menu with Live Substring Search Input */}
      {isOpen && !disabled && (
        <div className="absolute z-50 left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Search Bar */}
          <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (filteredOptions.length > 0) {
                    handleSelect(filteredOptions[0].value);
                  }
                }
              }}
              placeholder="Type any keyword, middle letters, or number (Press Enter)..."
              className="w-full bg-transparent text-xs font-semibold text-slate-800 placeholder-slate-400 outline-none pr-1"
              onClick={(e) => e.stopPropagation()}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-slate-400 hover:text-slate-600 p-1 text-xs"
              >
                Clear
              </button>
            )}
          </div>

          {/* Options List */}
          <div className="max-h-60 overflow-y-auto divide-y divide-slate-50 p-1">
            {filteredOptions.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 italic">
                No matching options found for "{query}"
              </div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = opt.value === value || opt.label === value;
                return (
                  <div
                    key={idx}
                    onClick={() => handleSelect(opt.value)}
                    className={`px-3 py-2 rounded-lg text-xs flex items-center justify-between cursor-pointer transition ${
                      isSelected ? 'bg-blue-50 text-blue-900 font-bold' : 'hover:bg-slate-100 text-slate-800'
                    }`}
                  >
                    <div>
                      <span className="block font-semibold">{opt.label}</span>
                      {opt.sublabel && (
                        <span className="block text-[10px] text-slate-500 font-normal">{opt.sublabel}</span>
                      )}
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-2" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
