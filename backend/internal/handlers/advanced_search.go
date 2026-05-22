package handlers

import (
	"fmt"
	"strconv"
	"strings"

	"gorm.io/gorm"
)

// AdvFilter is one row of the advanced-search filter builder. Field is checked
// against the entity's whitelist before being injected into SQL; Value and
// Value2 always pass through GORM parameter binding.
type AdvFilter struct {
	Field  string      `json:"field"`
	Op     string      `json:"op"`
	Value  interface{} `json:"value"`
	Value2 interface{} `json:"value2"`
}

// AdvSearchInput is the body shape of every advanced-search endpoint.
type AdvSearchInput struct {
	Filters  []AdvFilter `json:"filters"`
	Page     int         `json:"page"`
	PageSize int         `json:"page_size"`
}

// ApplyAdvancedFilters AND-combines every filter onto the query. Each filter's
// field is looked up in fieldTypes (the per-entity whitelist) — unknown fields
// are silently dropped, which is the SQL-injection guard for the field name.
// Values are passed through "?" binds, so values are safe too.
func ApplyAdvancedFilters(query *gorm.DB, filters []AdvFilter, fieldTypes map[string]string) *gorm.DB {
	for _, f := range filters {
		fType, ok := fieldTypes[f.Field]
		if !ok || f.Op == "" {
			continue
		}
		col := "`" + f.Field + "`"
		switch fType {
		case "string":
			v := strings.TrimSpace(fmt.Sprint(f.Value))
			if v == "" {
				continue
			}
			switch f.Op {
			case "contains":
				query = query.Where(col+" LIKE ?", "%"+v+"%")
			case "starts_with":
				query = query.Where(col+" LIKE ?", v+"%")
			case "ends_with":
				query = query.Where(col+" LIKE ?", "%"+v)
			case "equals":
				query = query.Where(col+" = ?", v)
			case "not_equals":
				query = query.Where(col+" <> ?", v)
			}
		case "enum":
			v := strings.TrimSpace(fmt.Sprint(f.Value))
			if v == "" {
				continue
			}
			switch f.Op {
			case "equals":
				query = query.Where(col+" = ?", v)
			case "not_equals":
				query = query.Where(col+" <> ?", v)
			}
		case "bool":
			b, ok := f.Value.(bool)
			if !ok {
				s := strings.ToLower(strings.TrimSpace(fmt.Sprint(f.Value)))
				b = s == "true" || s == "1" || s == "yes"
			}
			query = query.Where(col+" = ?", b)
		case "int":
			v := strings.TrimSpace(fmt.Sprint(f.Value))
			if v == "" {
				continue
			}
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				continue
			}
			switch f.Op {
			case "equals":
				query = query.Where(col+" = ?", n)
			case "gt":
				query = query.Where(col+" > ?", n)
			case "lt":
				query = query.Where(col+" < ?", n)
			}
		case "number":
			v := strings.TrimSpace(fmt.Sprint(f.Value))
			if v == "" {
				continue
			}
			fl, err := strconv.ParseFloat(v, 64)
			if err != nil {
				continue
			}
			switch f.Op {
			case "equals":
				query = query.Where(col+" = ?", fl)
			case "gt":
				query = query.Where(col+" > ?", fl)
			case "lt":
				query = query.Where(col+" < ?", fl)
			case "between":
				v2 := strings.TrimSpace(fmt.Sprint(f.Value2))
				fl2, err2 := strconv.ParseFloat(v2, 64)
				if err2 != nil {
					continue
				}
				query = query.Where(col+" BETWEEN ? AND ?", fl, fl2)
			}
		case "date":
			// DATE() cast makes BETWEEN inclusive on DATETIME columns too.
			switch f.Op {
			case "between":
				v1 := strings.TrimSpace(fmt.Sprint(f.Value))
				v2 := strings.TrimSpace(fmt.Sprint(f.Value2))
				if v1 == "" || v2 == "" {
					continue
				}
				query = query.Where("DATE("+col+") BETWEEN ? AND ?", v1, v2)
			case "after":
				v1 := strings.TrimSpace(fmt.Sprint(f.Value))
				if v1 == "" {
					continue
				}
				query = query.Where("DATE("+col+") >= ?", v1)
			case "before":
				v1 := strings.TrimSpace(fmt.Sprint(f.Value))
				if v1 == "" {
					continue
				}
				query = query.Where("DATE("+col+") <= ?", v1)
			case "equals":
				v1 := strings.TrimSpace(fmt.Sprint(f.Value))
				if v1 == "" {
					continue
				}
				query = query.Where("DATE("+col+") = ?", v1)
			}
		}
	}
	return query
}

// NormalizePaging caps page and page_size to safe defaults; returns offset.
func NormalizePaging(in *AdvSearchInput) int {
	if in.Page < 1 {
		in.Page = 1
	}
	if in.PageSize < 1 || in.PageSize > 200 {
		in.PageSize = 20
	}
	return (in.Page - 1) * in.PageSize
}
